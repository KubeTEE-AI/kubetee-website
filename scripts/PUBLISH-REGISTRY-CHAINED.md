# Publish the first chain-linked registry revision (Phase 6 §3.2)

**Purpose.** Activate registry anti-rollback (bar 4 of the zero-operator
program: *revoking a record retroactively invalidates it, even to a verifier
served stale registry bytes*). The verifier (Rust) and the gateway matcher now
enforce the transition-hash chain + a monotonic version floor; this run emits
the **first revision that actually carries a `chain`** and, on the next
revision onward, ratchets the floor so a stale pre-revocation registry is
rejected.

The current published registry is **`version 1, chain ABSENT`**. This run turns
it into **`version 2` with a `chain`** whose `bootstrap: true` links from
genesis (its predecessor is the pre-Phase-6 doc with no computable transition
hash). From revision 3 on, each links the previous `transition_hash` normally.

**Who runs it.** The holder of the offline Ed25519 measurements signing key
(`kubetee-measurements-2026-11-25`). The key never enters the repo or cluster.

## Pre-requisites

- `entries/` (already staged from the current 3 records — one JSON per record,
  each carrying the required `id, model, tee, runtime_class, image_ref,
  measurements, initdata, captured_at`).
- `cryptography` in the Python used — **required for signing only** (the chain
  build + self-check are stdlib). The macOS `/usr/bin/python3` (3.9) does NOT
  ship it; `/opt/homebrew/bin/python3.14` does. If missing:
  `pip install cryptography` or `python3.14 -m pip install cryptography`.

## Command (copy-paste as ONE block — absolute paths, no venv/shell variance)

```bash
cd /Users/pamanseau/VisualStudioCode/kubetee/kubetee/kubetee-website

# Use an interpreter that has `cryptography` (the Ed25519 signer). The chain
# build + self-check are stdlib; ONLY signing needs this dependency.
#
# ⚠️  Use the ABSOLUTE interpreter path. A repo venv (e.g. kubetee/.venv) does
# NOT inherit site/user packages and shadows `python3.14`, so a bare
# `python3.14` inside an activated venv fails at signing with
# `No module named 'cryptography'` even though the system one has it. The
# absolute Homebrew path below has `cryptography` regardless of the venv.
/opt/homebrew/bin/python3.14 -c 'import cryptography; print("cryptography", cryptography.__version__)'

/opt/homebrew/bin/python3.14 scripts/build-tee-measurements-registry.py \
  --entries-dir entries \
  --previous  public/.well-known/tee-measurements-registry.json \
  --signing-key-file "$HOME/kubetee-signing-keys/kubetee-measurements-2026-11-25.pem" \
  --out        public/.well-known/tee-measurements-registry.json
```

If the absolute path still reports a missing `cryptography`, run
`/opt/homebrew/bin/python3.14 -m pip install cryptography` (Homebrew Python is
externally-managed — prefer `brew install python-cryptography`), or `deactivate`
the venv and use the system interpreter. If the key path fails
(`signing key file not found`), check `--signing-key-file` got a real path — an
unset/empty `$SIGNING_KEY` expands to nothing and the tool refuses rather than
signing with a directory.

Notes:
- `--previous` is the **current published** doc; the tool reads it, sets
  `version = 2`, chains from its (absent) transition hash as `bootstrap: true`,
  computes `content_hash` / `transition_hash`, self-checks, signs over the doc
  **including** `chain`, and writes back to `--out`. (Without `--previous` it
  still chains from genesis via `--out`'s current contents — passing it
  explicitly is the safer, explicit form.)
- The tool self-checks BOTH the chain (`registry chain self-check: VERIFIED`)
  and the signature before writing, and refuses to emit an unsigned registry.
- **Not byte-reproducible across runs — by design.** `issued_at` (build time) is
  part of the signed content, so it feeds `content_hash` → `transition_hash`.
  Re-running the same `entries/` at a different time yields a different
  `transition_hash`. That is correct for a dated revision: the Ed25519 signature
  covers the exact served bytes (RFC 8785), so a verifier checks the doc it
  received, not a reconstruction. Verifiers chain by `previous_transition_hash`
  matching the prior doc's `transition_hash`, not by re-deriving a fixed value.
- To rotate / re-capture a model, edit/add a JSON under `entries/` and re-run
  the same command (each run bumps `version` and extends the chain). Use
  `--prune` to apply the current+previous-generation retention.

## After the run (operator, no signing key needed)

1. **Publish** `public/.well-known/tee-measurements-registry.json` to
   `https://kubetee.ai/.well-known/` (the normal site publish step).
2. **Pin the floor across gateway restarts** — the matcher ratchets an
   in-process floor that resets on restart; persist the accepted revision so a
   restart cannot be rolled back:
   ```bash
   kubectl set env deploy/litellm -n litellm \
     KUBETEE_REGISTRY_MIN_REVISION=2   # = the version just published
   ```
   (Leave unset only if you deliberately want a fresh-verifier floor.)
3. **Verify the chain end-to-end** with the reference verifier (now enforces
   chain + floor fail-closed):
   ```bash
   cargo run --manifest-path ../kubetee-attestation-verifier/Cargo.toml -- \
     verify --evidence <envelope.json> --registry public/.well-known/tee-measurements-registry.json \
     --min-revision 2
   # want: PASS registry-anti-rollback chain-links revision 2
   ```
4. **Rollback floor is now armed**: a future revocation is
   `--prune` (or `status: revoked`) + a re-run of the publish command →
   `version 3`, and any verifier with `min_revision >= 2` rejects the stale
   `version 2` it would otherwise have accepted.

## Expected first-run chain output

```
chain: linking to previous revision version=1 transition=(pre-chain bootstrap)
registry chain self-check: VERIFIED
wrote public/.well-known/tee-measurements-registry.json with 3 record(s):
```
