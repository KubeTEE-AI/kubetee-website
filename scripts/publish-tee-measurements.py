#!/usr/bin/env python3
"""Measure -> verify -> sign -> publish KubeTEE TEE measurement records.

The ONE reusable publisher for every image KubeTEE builds and deploys. CI chains
this onto each image build (SGLang `kimi-k3.1-pro` canary / `v0.5.23` + nightly
lineages, and the LiteLLM gateway) once the image's immutable digest is known and
a running guest of THAT image has minted an evidence envelope over
`/kubetee/evidence` (TDX backend) or `/v1/attestation` (SNP gateway).

For each new image it:
  1. MEASURES   - reads the live evidence envelope a deployed guest minted
                  (user decision: live-at-deploy capture, node-agnostic).
  2. VERIFIES   - the TDX/SNP launch registers, the report_data JCS binding, and
                  (optionally) the CCEL replay reproduce the quote. Registers are
                  a function of the Kata launch config, NOT the image or node --
                  so one register set is shared across all nodes and both
                  lineages; a new image adds provenance, not new registers.
  3. SIGNS      - RFC 8785 (JCS) over the record with the `signature` member
                  removed, Ed25519 with the CI signing key
                  (`secrets.TEE_MEASUREMENTS_SIGNING_KEY` = PEM, key_id
                  `kubetee-measurements-2026-11-25`). A generated-but-unsigned
                  record is a DRAFT, never evidence.
  4. PUBLISHES  - writes `.well-known/tee-measurements*.{json,cbor,...}` and the
                  derived RVPS CoRIM. CI commits to `kubetee-website@main`; GH
                  Pages serves them BEFORE the image serves traffic so clients can
                  validate `GET /v1/attestation` immediately.

Usage (CI):
  python3 scripts/publish-tee-measurements.py \
    --envelope evidence.json \
    --provenance provenance.json \
    --signing-key "$TEE_MEASUREMENTS_SIGNING_KEY" \
    --out-dir public/.well-known

Usage (offline sign only, private key stays offline):
  python3 scripts/publish-tee-measurements.py --signing-key-file /path/key.pem ...
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
import sys
from pathlib import Path

try:
    import cbor2
    from cbor2 import CBORTag
except ImportError:  # pragma: no cover
    sys.exit("needs cbor2:  python3 -m pip install cbor2")

KEY_ID = "kubetee-measurements-2026-11-25"
SHA384_ALG = 7  # corim-rs HashAlgorithm::Sha384 -> to_u8() == 7
TDINFO_OFFSET = 184  # 48-byte TDX quote v4 header + 136-byte report body
REPORT_DATA_OFFSET = TDINFO_OFFSET + 384  # TDINFO field order (validated)

# TDINFO register field layout (48-byte SHA-384 registers, back to back).
REGISTER_FIELDS = {
    "mrtd": (TDINFO_OFFSET, 48),
    "mrconfigid": (TDINFO_OFFSET + 48, 48),
    "mrowner": (TDINFO_OFFSET + 96, 48),
    "mrownerconfig": (TDINFO_OFFSET + 144, 48),
    "rtmr0": (TDINFO_OFFSET + 192, 48),
    "rtmr1": (TDINFO_OFFSET + 240, 48),
    "rtmr2": (TDINFO_OFFSET + 288, 48),
    "rtmr3": (TDINFO_OFFSET + 336, 48),
}
REPORT_DATA_REGISTER = (REPORT_DATA_OFFSET, 64)


def _b64d(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def _b64e(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).decode().rstrip("=")


def extract_tdx_registers(quote_b64url: str) -> dict[str, str]:
    """Pull the measured TDINFO registers out of a TDX quote v4 body.

    Same field mapping as `dcap_qvl::quote::TDReport10` (mr_td / mr_config_id /
    rt_mr0-3) used by the validated `gm-miner/attestd` verifier. MRTD +
    MRCONFIGID + RTMR0-3 are node- and image-agnostic launch registers.
    """
    quote = _b64d(quote_b64url)
    out: dict[str, str] = {}
    for name, (off, ln) in REGISTER_FIELDS.items():
        if len(quote) < off + ln:
            raise SystemExit(f"TDX quote too short for {name} (len {len(quote)})")
        out[name] = quote[off:off + ln].hex()
    return out


def extract_tdx_report_data(quote_b64url: str) -> bytes:
    quote = _b64d(quote_b64url)
    off, ln = REPORT_DATA_REGISTER
    return quote[off:off + ln]


def jcs(obj) -> bytes:
    """RFC 8785 (JCS) bytes for a JSON object -- the exact serialization the
    published records sign over. Sorted keys, no whitespace, UTF-8."""
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()


def verify_report_data_binding(envelope: dict) -> None:
    """report_data MUST equal sha256(JCS(statement)) || 32 zero bytes
    (`kubetee.attestation.v1`). TDX (epoch form) carries `report_data` +
    `report_data_statement` at top level; SNP carries the statement under
    `bindings.report_data_statement` and the 64-byte value under `evidence`.
    Locate whichever shape is present and check the binding; fail closed."""
    stmt = (envelope.get("report_data_statement")
            or (envelope.get("bindings") or {}).get("report_data_statement"))
    if not stmt:
        raise SystemExit("no report_data_statement in envelope -- refusing")
    # Find the 64-byte report_data wherever this envelope shape puts it.
    rd_b64 = (envelope.get("report_data") or ""
              or (envelope.get("evidence") or {}).get("quote_report_data") or ""
              or (envelope.get("evidence") or {}).get("report_data") or "")
    if not rd_b64:
        raise SystemExit("no report_data in envelope -- refusing")
    rd = _b64d(rd_b64)
    expected = hashlib.sha256(stmt.encode()).digest() + bytes(32)
    if rd != expected:
        raise SystemExit("report_data does not bind sha256(statement)||0^32 -- refusing")


def build_tdx_record(envelope: dict, meta: dict, *, not_before: str) -> dict:
    """Assemble the client-facing TDX measurement record
    (`kubetee.tee-measurements/1`, the gold shape): exactly
    schema/version/status/not_before/key_id/measurements/initdata/guest/signature.
    `initdata` + `guest` describe the Kata LAUNCH CONFIG (which is what determines
    the registers) -- so they are shared across nodes and lineages and MUST match
    every image that launches this class. `measurements` are read from the live
    quote (image/node-agnostic). The image digest that minted this published
    instance belongs in `guest.images` / caller-supplied `provenance`."""
    regs = extract_tdx_registers(envelope["quote"])
    measurements = {
        "mrtd": "hex:" + regs["mrtd"],
        "rtmr0": "hex:" + regs["rtmr0"],
        "rtmr1": "hex:" + regs["rtmr1"],
        "rtmr2": "hex:" + regs["rtmr2"],
        "rtmr3": "hex:" + regs["rtmr3"],
        "mrconfigid": "hex:" + regs["mrconfigid"],
    }
    record = {
        "schema": "kubetee.tee-measurements/1",
        "version": 1,
        "status": "active",
        "not_before": not_before,
        "key_id": KEY_ID,
        "measurements": measurements,
        "initdata": meta["initdata"],
        "guest": meta["guest"],
    }
    # Optional provenance when the caller supplies it (kept out of the 9-key shape).
    if "provenance" in meta:
        record["provenance"] = meta["provenance"]
    return record


def build_snp_record(meta: dict) -> dict:
    """Assemble the SNP gateway record (`kubetee.tee-measurements/2`), the richer
    shape backing the gateway's `GET /v1/attestation` reference. The SNP launch
    measurement is node/image-agnostic (sev-snp-measure over the launch inputs)."""
    record = {
        "schema": "kubetee.tee-measurements/2",
        "version": 1,
        "status": "active",
    }
    for key in ("role", "tee", "runtime_class", "not_before", "key_id", "key_url",
                "subject", "provenance", "snp", "attestation"):
        if key in meta:
            record[key] = meta[key]
    record.setdefault("key_id", KEY_ID)
    return record


def build_record(envelope: dict, meta: dict, *, tee: str, not_before: str) -> dict:
    """Dispatch on TEE type (TDX /1 vs SNP /2)."""
    if tee == "tdx":
        return build_tdx_record(envelope, meta, not_before=not_before)
    return build_snp_record(meta)


def sign_record(record: dict, key_pem: bytes) -> dict:
    """Attach `signature` = Ed25519(RFC8785 of record WITHOUT the signature member)."""
    unsigned = {k: v for k, v in record.items() if k != "signature"}
    message = jcs(unsigned)
    sig = _ed25519_sign(message, key_pem)
    record["signature"] = {
        "alg": "ed25519",
        "key_id": KEY_ID,
        "canonicalization": "RFC8785-without-signature-member",
        "sig": _b64e(sig),
    }
    return record


def _ed25519_sign(message: bytes, key_pem: bytes) -> bytes:
    """Sign with the Ed25519 key. Uses `cryptography` (in the GH ubuntu runner /
    cbor2 venv); the private half is passed only via env/PEM bytes, never argv."""
    from cryptography.hazmat.primitives.asymmetric.ed25519 import (
        Ed25519PrivateKey,
    )
    from cryptography.hazmat.primitives.serialization import (
        load_pem_private_key,
    )

    key = load_pem_private_key(key_pem, password=None)
    if not isinstance(key, Ed25519PrivateKey):
        raise SystemExit("signing key is not Ed25519")
    return key.sign(message)


# --- CoRIM (RVPS) twin ---------------------------------------------------------
def build_corim(vendor: str, model: str, regs: dict[str, str],
                corim_id: str, tag_id: str) -> bytes:
    """The CoRIM twin for RVPS ingestion. URIs are namespaced
    `kubetee/<model>/<register>/digests` and therefore inert to the stock
    `default_cpu` policy (which queries bare mr_td/rtmr_1/...). One compound
    reference-triple: all registers must match together (RATS compound RV)."""
    order = [("mr_td", regs["mrtd"]), ("rtmr_0", regs["rtmr0"]),
             ("rtmr_1", regs["rtmr1"]), ("rtmr_2", regs["rtmr2"]),
             ("rtmr_3", regs["rtmr3"]), ("mr_config_id", regs["mrconfigid"])]
    claims = []
    for mkey, hexval in order:
        digest = bytes.fromhex(hexval)
        if len(digest) != 48:
            raise SystemExit(f"{mkey}: expected 48-byte SHA-384, got {len(digest)}")
        claims.append({0: mkey, 1: {2: [[SHA384_ALG, digest]]}})
    environment = {0: {1: vendor, 2: model}}
    triples = {0: [[environment, claims]]}
    comid_map = {1: {0: tag_id, 1: 1}, 4: triples}
    comid = CBORTag(506, cbor2.dumps(comid_map, canonical=True))
    corim = CBORTag(501, {0: corim_id, 1: [comid]})
    return cbor2.dumps(corim, canonical=True)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--envelope", type=Path, required=True,
                    help="live evidence envelope JSON (from /kubetee/evidence or /v1/attestation)")
    ap.add_argument("--provenance", type=Path, required=True,
                    help="provenance JSON (image digest, source commit, CI run)")
    ap.add_argument("--model", default="sglang-kimi-k3-1-pro",
                    help="CoRIM model class (the model, never a node/deployment suffix)")
    ap.add_argument("--vendor", default="kubetee")
    ap.add_argument("--signing-key", help="Ed25519 PEM (prefer env var in CI)")
    ap.add_argument("--signing-key-file", type=Path, help="Ed25519 PEM file (offline)")
    ap.add_argument("--out-dir", type=Path, required=True)
    ap.add_argument("--json-name", default="tee-measurements-sglang.tdx.json")
    ap.add_argument("--require-signature", action="store_true",
                    help="fail closed if no signing key -- never emit an unsigned draft "
                         "(a draft is not evidence)")
    a = ap.parse_args()

    env = json.loads(a.envelope.read_text())
    meta = json.loads(a.provenance.read_text())
    tee = meta.get("tee", "tdx")
    not_before = meta.get("not_before", env.get("issued_at", ""))

    verify_report_data_binding(env)

    record = build_record(env, meta, tee=tee, not_before=not_before)

    key_pem = None
    if a.signing_key:
        key_pem = a.signing_key.encode() if a.signing_key.startswith("-----") else Path(a.signing_key).read_bytes()
    elif a.signing_key_file:
        key_pem = a.signing_key_file.read_bytes()
    elif os.environ.get("TEE_MEASUREMENTS_SIGNING_KEY"):
        key_pem = os.environ["TEE_MEASUREMENTS_SIGNING_KEY"].encode()

    if key_pem:
        record = sign_record(record, key_pem)
    elif a.require_signature:
        # Fail closed BEFORE writing -- a generated-but-unsigned record is a draft,
        # not evidence; never let it reach the auto-publish path.
        raise SystemExit("signing key required (--require-signature) but none provided -- "
                         "refusing to emit an unsigned draft")
    else:
        record["signature"] = {
            "_note": "PENDING-SIGNATURE -- unsigned draft is NOT evidence",
            "alg": "ed25519", "key_id": KEY_ID,
            "canonicalization": "RFC8785-without-signature-member",
            "sig": "PENDING-SIGNATURE",
        }

    a.out_dir.mkdir(parents=True, exist_ok=True)
    (a.out_dir / a.json_name).write_text(json.dumps(record, indent=2) + "\n")

    # CoRIM twin (TDX only -- SNP has no CoRIM in this pipeline yet)
    if tee == "tdx":
        regs = extract_tdx_registers(env["quote"])
        corim = build_corim(a.vendor, a.model, regs,
                            f"kubetee-tee-reference-values-{a.model.replace('sglang-', '')}-tdx",
                            f"kubetee-{a.model}-tdx-reference-values")
        (a.out_dir / "tee-reference-values.cbor").write_bytes(corim)
        (a.out_dir / "tee-reference-values.cbor.sha256").write_text(
            hashlib.sha256(corim).hexdigest() + "  tee-reference-values.cbor\n")

    print(f"published {a.out_dir / a.json_name} tee={tee} signed={key_pem is not None}")
    if tee == "tdx":
        for k, v in extract_tdx_registers(env["quote"]).items():
            print(f"  {k} = {v}")


if __name__ == "__main__":
    main()
