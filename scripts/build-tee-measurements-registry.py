#!/usr/bin/env python3
"""Build + sign the KubeTEE per-model TEE measurement REGISTRY (the one allowlist).

The registry is a SINGLE signed `.well-known/tee-measurements-registry.json` whose
`records[]` enumerate every deployed measured instance (model + image + registers).
A gateway or client needing to decide "is this observed TEE evidence legitimate?"
does NOT pin a per-model / per-image reference. It verifies the registry against
the pinned signing-key fingerprint and checks the observed registers match
**ANY active (non-expired) record**. Deploying a new measured model is one more
`records[]` entry + a re-sign -- never a code/env/doc pin on the verifier.

Per-record lifecycle (current + previous generation per chain, user decision
2026-11-26 — REPLACES the earlier 90-day clock, which was retired as overkill:
measurements change only at a rollout, so time-based re-capture was pure churn):
  * A record's GENERATION is its immutable `image_ref`; its CHAIN is
    (model, role, tee). The top 2 generations per chain (current + previous)
    stay ACTIVE so BOTH verify during AND after a rollout — the old generation
    keeps matching until the rollout completes, and doubles as the rollback
    window. A record leaves the allowlist only when a 3rd newer generation
    lands in its chain (`--prune`), or it is hard-expired / deprecated /
    revoked. Multiple records per generation (per-node RTMR0 captures,
    re-captures) are all kept while that generation is in the window.
  * `valid_until` is OPTIONAL and manual-only (e.g. throwaway canaries):
    absent = no expiry. A record past `valid_until`, or with
    `status: "deprecated"` / `"revoked"` / `"retired"`, never matches.
  * `supersedes` (optional metadata) names the record id this replaces.

Usage (offline sign; the private key never enters the repo or cluster):
  build-tee-measurements-registry.py \
      --entry entry-kimi.json --entry entry-mimo.json \
      --signing-key-file ~/kubetee-signing-keys/kubetee-measurements-2026-11-25.pem \
      --out public/.well-known/tee-measurements-registry.json

  # re-capture / add a model later, re-sign the whole registry:
  build-tee-measurements-registry.py --entries-dir entries/ --signing-key-file ... 

  # apply retention (current+previous per chain) + drop deprecated/expired:
  build-tee-measurements-registry.py --entries-dir entries/ --prune --signing-key-file ... 
"""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import os
from pathlib import Path

KEY_ID = "kubetee-measurements-2026-11-25"
KEY_URL = "https://kubetee.ai/.well-known/tee-measurements-signing-key-2026.json"

# -- registry anti-rollback: signed transition-hash chain (Phase 6, §3.2) -------
# Each published revision carries a `chain` member binding it to the previous
# revision's transition hash (Contrast-style manifest history):
#   content_hash        = sha256(jcs(doc minus signature and chain))
#   transition_hash     = sha256(TAG || framed(content_hash) || framed(previous_transition_hash))
# where framed(x) = u64-be length || x and TAG is the ASCII domain-separation
# string below. The Ed25519 signature covers the doc INCLUDING `chain`, so the
# history cannot be spliced onto a signed record-set. A verifier that has ever
# seen a transition hash / revision keeps it as its floor and rejects anything
# served below it. Byte-identical construction to
# kubetee-attestation-verifier (src/registry.rs) -- the known-answer vector in
# tests/test_registry_chain.py pins the cross-language agreement.
TRANSITION_TAG = b"kubetee.registry.transition/1"
GENESIS_PREVIOUS = "00" * 32
CHAIN_ALGORITHM = "sha256"
# Retention: the top RETENTION_GENERATIONS (current + previous) immutable image
# generations per chain stay active so BOTH verify through and after a rollout
# (user decision 2026-11-26: measurements change only at rollout; the 90-day
# clock was retired as overkill).
RETENTION_GENERATIONS = 2

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


def _framed(part: bytes) -> bytes:
    return len(part).to_bytes(8, "big") + part


def content_hash(registry: dict) -> str:
    """sha256 over the JCS of the doc minus `signature` and `chain` (hex)."""
    unsigned = {k: v for k, v in registry.items() if k not in ("signature", "chain")}
    return hashlib.sha256(jcs(unsigned)).hexdigest()


def transition_hash(content_hex: str, previous_transition_hex: str) -> str:
    """sha256 over TAG || framed(content_hash) || framed(previous) (hex)."""
    preimage = TRANSITION_TAG + _framed(content_hex.encode()) + _framed(previous_transition_hex.encode())
    return hashlib.sha256(preimage).hexdigest()


def attach_chain(registry: dict, previous: dict | None) -> dict:
    """Bind `registry` to the previously published revision and stamp `chain`.

    - version = previous version + 1 (genesis: 1).
    - previous_transition_hash = the previous revision's chain.transition_hash.
      A predecessor WITHOUT a chain (pre-Phase-6 revision) is a chain bootstrap:
      the new revision chains from GENESIS and says so (`bootstrap: true`) --
      the pre-chain revision's content is still covered by the registry
      signature history, it just has no computable transition hash.
    - content_hash is computed BEFORE `chain` exists (it excludes `chain`), and
      `version` is set first so it is inside the hashed content.
    """
    if previous is None:
        version, prev_trans, bootstrap = 1, GENESIS_PREVIOUS, True
    else:
        version = int(previous.get("version") or 0) + 1
        prev_chain = previous.get("chain") or {}
        prev_trans = prev_chain.get("transition_hash") or GENESIS_PREVIOUS
        bootstrap = not prev_chain.get("transition_hash")
    registry["version"] = version
    c = content_hash(registry)
    t = transition_hash(c, prev_trans)
    chain = {
        "algorithm": CHAIN_ALGORITHM,
        "content_hash": c,
        "previous_transition_hash": prev_trans,
        "transition_hash": t,
    }
    if previous is not None:
        chain["previous_version"] = int(previous.get("version") or 0)
    if bootstrap and previous is not None:
        chain["bootstrap"] = True
    registry["chain"] = chain
    return registry


def verify_chain(registry: dict) -> None:
    """Self-check the chain member before writing (fail closed)."""
    chain = registry.get("chain") or {}
    for k in ("content_hash", "previous_transition_hash", "transition_hash"):
        v = chain.get(k) or ""
        if len(v) != 64 or any(c not in "0123456789abcdef" for c in v):
            raise SystemExit(f"chain.{k} missing or not 64 lowercase hex chars")
    c = content_hash(registry)
    if c != chain["content_hash"]:
        raise SystemExit(f"chain.content_hash mismatch: computed {c}, served {chain['content_hash']}")
    t = transition_hash(chain["content_hash"], chain["previous_transition_hash"])
    if t != chain["transition_hash"]:
        raise SystemExit(f"chain.transition_hash mismatch: computed {t}, served {chain['transition_hash']}")
    print("registry chain self-check: VERIFIED")


def _b64e(b: bytes) -> str:
    import base64
    return base64.urlsafe_b64encode(b).decode().rstrip("=")


def _parse_ts(s: str) -> dt.datetime:
    return dt.datetime.fromisoformat(s.replace("Z", "+00:00"))


def _fmt_ts(t: dt.datetime) -> str:
    return t.astimezone(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def normalize_entry(entry: dict) -> dict:
    """Validate + derive lifecycle status onto one record entry.

    `valid_until` is OPTIONAL (manual hard-expiry only, e.g. throwaway canaries)
    — never auto-stamped. Absent = no expiry. An explicitly-past `valid_until`
    materializes as status=deprecated (the matcher skips it either way).
    """
    missing = [k for k in REQUIRED_ENTRY_FIELDS if k not in entry]
    if missing:
        raise SystemExit(f"entry {entry.get('id', '?')}: missing {missing}")
    _parse_ts(entry["captured_at"])  # must be RFC3339
    valid_until = entry.get("valid_until")
    if valid_until:
        _parse_ts(valid_until)
    if entry.get("status") not in ("active", "deprecated", "revoked", "retired"):
        entry["status"] = "active"
    if entry["status"] == "active" and valid_until and _parse_ts(valid_until) <= dt.datetime.now(dt.timezone.utc):
        entry["status"] = "deprecated"  # manual hard-expiry reached
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


def _chain_key(rec: dict) -> tuple:
    """Supersession chain: one (model, role, tee) family rolls versions together."""
    return (rec.get("model"), rec.get("role"), rec.get("tee"))


def _generation(rec: dict) -> str:
    """One GENERATION = one immutable image (content-addressed `image_ref`).

    Per-node RTMR0 captures and re-captures of the SAME image share a
    generation (all kept together while that generation is in the window).
    """
    return str(rec.get("image_ref") or rec.get("id"))


def retention(entries: list[dict]) -> list[dict]:
    """Keep the top RETENTION_GENERATIONS (current + previous) per chain.

    Newest-first by `captured_at`; all records of an in-window generation are
    kept (per-node captures), and only the records of generations older than
    the window are dropped. This is what makes mid-rollout verification work:
    a new generation is captured and published BEFORE the rollout, so the
    previous generation must stay matchable until the rollout completes.
    """
    chains: dict[tuple, list[dict]] = {}
    for e in entries:
        chains.setdefault(_chain_key(e), []).append(e)
    keep: list[dict] = []
    dropped: list[str] = []
    for chain in sorted(chains, key=str):
        recs = sorted(chains[chain], key=lambda e: str(e.get("captured_at", "")), reverse=True)
        gens: list[str] = []
        for e in recs:
            g = _generation(e)
            if g not in gens:
                gens.append(g)
        in_window = set(gens[:RETENTION_GENERATIONS])
        for e in recs:
            if _generation(e) in in_window:
                keep.append(e)
            else:
                dropped.append(f"{e['id']} (generation {len(gens) - gens.index(_generation(e))} of {len(gens)} in chain {'/'.join(map(str, chain))})")
    if dropped:
        print(f"retention: dropped {len(dropped)} record(s) beyond current+previous per chain:")
        for d in dropped:
            print(f"  {d}")
    return keep


def prune(entries: list[dict]) -> list[dict]:
    """Retention housekeeping: apply current+previous per chain, drop dead records."""
    dead = [e for e in entries if e["status"] != "active"]
    if dead:
        print(f"pruned (deprecated/revoked/hard-expired): {[e['id'] for e in dead]}")
    alive = [e for e in entries if e["status"] == "active"]
    return retention(alive)


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
                "record with status=active and now <= valid_until (when set), for "
                "the same `tee`. No per-model / per-image pin on the verifier."
            ),
            "retention": {
                "generations_per_chain": RETENTION_GENERATIONS,
                "chain": "model + role + tee (a chain rolls versions together)",
                "generation": "one immutable image_ref (content-addressed)",
                "note": (
                    "current + previous generation per chain stay ACTIVE so BOTH "
                    "verify during AND after a rollout (the old generation keeps "
                    "matching until the rollout completes, and is the rollback "
                    "window). A record leaves the allowlist only when a 3rd newer "
                    "generation lands in its chain (rebuild with --prune), or it "
                    "is hard-expired / deprecated / revoked. Measurements change "
                    "only at a rollout: there is no time-based re-capture."
                ),
            },
            "hard_expiry": (
                "valid_until is OPTIONAL and manual-only (e.g. throwaway canaries); "
                "absent = no expiry. A record past valid_until, or with status in "
                "{deprecated, revoked, retired}, never matches."
            ),
        },
        "records": entries,
    }


def sign_registry(registry: dict, key_pem: bytes) -> dict:
    unsigned = {k: v for k, v in registry.items() if k != "signature"}
    try:
        from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
        from cryptography.hazmat.primitives.serialization import load_pem_private_key
    except ModuleNotFoundError as e:
        raise SystemExit(
            f"missing signing dependency ({e}) -- `pip install cryptography` in the "
            "interpreter running this script, or use the Homebrew python "
            "(/opt/homebrew/bin/python3.14, which ships it). The chain build and "
            "self-check already passed; only signing needs this dependency."
        ) from None
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
                    help="apply retention (current+previous per chain) and drop deprecated/expired records")
    ap.add_argument("--signing-key", help="Ed25519 PEM string")
    ap.add_argument("--signing-key-file", type=Path, help="Ed25519 PEM file (offline)")
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--previous", type=Path,
                    help="the previously published registry JSON (for the "
                         "transition-hash chain). Defaults to the current "
                         "contents of --out when present.")
    ap.add_argument("--require-signature", action="store_true", default=True,
                    help="fail closed if no signing key (default on)")
    a = ap.parse_args()

    entries = load_entries(a)
    if a.prune:
        entries = prune(entries)

    registry = build_registry(entries)

    # Anti-rollback chain: link this revision to the previously published one.
    previous = None
    prev_path = a.previous or (a.out if a.out.exists() else None)
    if prev_path and prev_path.exists():
        previous = json.loads(prev_path.read_text())
        print(f"chain: linking to previous revision "
              f"version={previous.get('version')} "
              f"transition={(previous.get('chain') or {}).get('transition_hash', '(pre-chain bootstrap)')}")
    else:
        print("chain: genesis revision (previous_transition_hash = 64 zeros)")
    registry = attach_chain(registry, previous)
    verify_chain(registry)

    key_pem = None
    if a.signing_key:
        key_pem = a.signing_key.encode() if a.signing_key.startswith("-----") else Path(a.signing_key).read_bytes()
    elif a.signing_key_file:
        key_path = Path(a.signing_key_file).expanduser()
        if not key_path.is_file():
            raise SystemExit(
                f"signing key file not found: {key_path} -- pass --signing-key-file "
                "/path/to/key.pem (the offline Ed25519 key). If it printed a path, "
                "check the flag value is not empty (an unset $VAR expands to nothing)."
            )
        key_pem = key_path.read_bytes()
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
        # valid_until is OPTIONAL (spec §5: reserved for manual hard-expiry); absent = no expiry.
        print(f"  [{e.get('status', '?')}] {e.get('id', '?'):32} "
              f"model={e.get('model', '?')} valid_until={e.get('valid_until', '(none)')}")


if __name__ == "__main__":
    main()
