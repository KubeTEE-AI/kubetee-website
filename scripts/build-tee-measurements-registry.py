#!/usr/bin/env python3
"""Build + sign the KubeTEE per-model TEE measurement REGISTRY (the one allowlist).

The registry is a SINGLE signed `.well-known/tee-measurements-registry.json` whose
`records[]` enumerate every deployed measured instance (model + image + registers).
A gateway or client needing to decide "is this observed TEE evidence legitimate?"
does NOT pin a per-model / per-image reference. It verifies the registry against
the pinned signing-key fingerprint and checks the observed registers match
**ANY active (non-expired) record**. Deploying a new measured model is one more
`records[]` entry + a re-sign -- never a code/env/doc pin on the verifier.

Per-record lifecycle (90-day deprecation, user decision 2026-11-25):
  * `captured_at` -> `valid_until = captured_at + policy.record_validity_days`.
  * A record past `valid_until` is DEPRECATED: its measurements are no longer
    trusted and it must be re-captured + re-added (rotate) or dropped (`--prune`).
  * `status: "deprecated"` forces deprecation early (manual).

Usage (offline sign; the private key never enters the repo or cluster):
  build-tee-measurements-registry.py \
      --entry entry-kimi.json --entry entry-mimo.json \
      --signing-key-file ~/kubetee-signing-keys/kubetee-measurements-2026-11-25.pem \
      --out public/.well-known/tee-measurements-registry.json

  # re-capture / add a model later, re-sign the whole registry:
  build-tee-measurements-registry.py --entries-dir entries/ --signing-key-file ... 

  # drop expired/deprecated records, re-sign:
  build-tee-measurements-registry.py --entries-dir entries/ --prune --signing-key-file ...
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
from pathlib import Path

KEY_ID = "kubetee-measurements-2026-11-25"
KEY_URL = "https://kubetee.ai/.well-known/tee-measurements-signing-key-2026.json"
RECORD_VALIDITY_DAYS = 90  # user decision: deprecate measurements not in use ~90 days

SCHEMA = "kubetee.tee-measurements-registry/1"

# Fields every entry must carry (identity + what is measured). `model`/`image_ref`
# are provenance/traceability for a human -- they are NOT part of the match (a
# match is same-tee + registers + active/not-expired; no per-model pin).
REQUIRED_ENTRY_FIELDS = (
    "id", "model", "tee", "runtime_class", "image_ref",
    "measurements", "initdata", "captured_at",
)


def jcs(obj) -> bytes:
    """RFC 8785 (JCS) bytes -- the exact serialization the registry signs over.
    Sorted keys, no whitespace, UTF-8. Identical to publish-tee-measurements.py."""
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()


def _b64e(b: bytes) -> str:
    import base64
    return base64.urlsafe_b64encode(b).decode().rstrip("=")


def _parse_ts(s: str) -> dt.datetime:
    return dt.datetime.fromisoformat(s.replace("Z", "+00:00"))


def _fmt_ts(t: dt.datetime) -> str:
    return t.astimezone(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def normalize_entry(entry: dict) -> dict:
    """Validate + stamp lifecycle timestamps and status onto one record entry."""
    missing = [k for k in REQUIRED_ENTRY_FIELDS if k not in entry]
    if missing:
        raise SystemExit(f"entry {entry.get('id', '?')}: missing {missing}")
    captured = _parse_ts(entry["captured_at"])
    valid_until = entry.get("valid_until")
    if not valid_until:
        valid_until = _fmt_ts(captured + dt.timedelta(days=RECORD_VALIDITY_DAYS))
    entry["valid_until"] = valid_until
    # status: explicit "deprecated" wins; else derived from expiry at build time.
    if entry.get("status") not in ("active", "deprecated"):
        entry["status"] = "active"
    if entry["status"] != "deprecated" and _parse_ts(valid_until) <= dt.datetime.now(dt.timezone.utc):
        entry["status"] = "deprecated"  # expired -> deprecated (90-day deprecation)
    return entry


def load_entries(args) -> list[dict]:
    entries: list[dict] = []
    if args.entries_dir:
        for p in sorted(Path(args.entries_dir).glob("*.json")):
            entries.append(json.loads(p.read_text()))
    for p in args.entry or []:
        entries.append(json.loads(Path(p).read_text()))
    if not entries:
        raise SystemExit("no entries given (--entry or --entries-dir)")
    ids = [e.get("id") for e in entries]
    if len(ids) != len(set(ids)):
        raise SystemExit(f"duplicate record ids: {ids}")
    return [normalize_entry(e) for e in entries]


def prune(entries: list[dict]) -> list[dict]:
    """90-day deprecation housekeeping: drop deprecated/expired records."""
    keep = [e for e in entries if e["status"] == "active"]
    dropped = [e["id"] for e in entries if e["status"] != "active"]
    if dropped:
        print(f"pruned (deprecated/expired): {dropped}")
    return keep


def build_registry(entries: list[dict]) -> dict:
    return {
        "schema": SCHEMA,
        "version": 1,
        "key_id": KEY_ID,
        "key_url": KEY_URL,
        "issued_at": _fmt_ts(dt.datetime.now(dt.timezone.utc)),
        "policy": {
            "match": "any-active-record",
            "match_note": (
                "Observed TEE evidence is legitimate iff its registers match ANY "
                "record with status=active and now <= valid_until, for the same "
                "`tee`. No per-model / per-image pin on the verifier."
            ),
            "record_validity_days": RECORD_VALIDITY_DAYS,
            "deprecation": (
                "A record past valid_until (or status=deprecated) is DEPRECATED: "
                "its measurements are no longer trusted. Re-capture + re-add to "
                "rotate, or drop with --prune."
            ),
        },
        "records": entries,
    }


def sign_registry(registry: dict, key_pem: bytes) -> dict:
    unsigned = {k: v for k, v in registry.items() if k != "signature"}
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
    from cryptography.hazmat.primitives.serialization import load_pem_private_key
    key = load_pem_private_key(key_pem, password=None)
    if not isinstance(key, Ed25519PrivateKey):
        raise SystemExit("signing key is not Ed25519")
    sig = key.sign(jcs(unsigned))
    registry["signature"] = {
        "alg": "ed25519",
        "key_id": KEY_ID,
        "canonicalization": "RFC8785-without-signature-member",
        "sig": _b64e(sig),
    }
    return registry


def verify_registry(registry: dict) -> None:
    """Self-check the signature before writing (never emit an unsigned/unverified
    registry -- it is the trust root for the gate)."""
    sig = registry.get("signature") or {}
    if sig.get("sig") in (None, "PENDING-SIGNATURE"):
        raise SystemExit("registry is unsigned -- refusing to write")
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
    from cryptography.hazmat.primitives.serialization import load_der_public_key
    import base64
    x = os.environ.get("KUBETEE_REGISTRY_VERIFY_X")  # optional public-x self-check
    if x:
        der = bytes.fromhex("302a300506032b6570032100") + base64.urlsafe_b64decode(x + "=" * (-len(x) % 4))
        pub = load_der_public_key(der)
        unsigned = {k: v for k, v in registry.items() if k != "signature"}
        pub.verify(base64.urlsafe_b64decode(sig["sig"] + "=" * (-len(sig["sig"]) % 4)), jcs(unsigned))
        print("registry signature self-check: VERIFIED")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--entry", action="append", type=Path,
                    help="a per-record entry JSON (repeatable)")
    ap.add_argument("--entries-dir", type=Path,
                    help="directory of per-record entry JSON files")
    ap.add_argument("--prune", action="store_true",
                    help="drop deprecated/expired records (90-day deprecation housekeeping)")
    ap.add_argument("--signing-key", help="Ed25519 PEM string")
    ap.add_argument("--signing-key-file", type=Path, help="Ed25519 PEM file (offline)")
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--require-signature", action="store_true", default=True,
                    help="fail closed if no signing key (default on)")
    a = ap.parse_args()

    entries = load_entries(a)
    if a.prune:
        entries = prune(entries)

    registry = build_registry(entries)

    key_pem = None
    if a.signing_key:
        key_pem = a.signing_key.encode() if a.signing_key.startswith("-----") else Path(a.signing_key).read_bytes()
    elif a.signing_key_file:
        key_pem = a.signing_key_file.read_bytes()
    elif os.environ.get("TEE_MEASUREMENTS_SIGNING_KEY"):
        key_pem = os.environ["TEE_MEASUREMENTS_SIGNING_KEY"].encode()

    if not key_pem:
        raise SystemExit("signing key required -- the registry is the trust root; "
                         "never emit an unsigned one")

    registry = sign_registry(registry, key_pem)
    verify_registry(registry)

    a.out.parent.mkdir(parents=True, exist_ok=True)
    a.out.write_text(json.dumps(registry, indent=2) + "\n")
    print(f"wrote {a.out} with {len(entries)} record(s):")
    for e in entries:
        print(f"  [{e['status']}] {e['id']:32} model={e['model']} valid_until={e['valid_until']}")


if __name__ == "__main__":
    main()
