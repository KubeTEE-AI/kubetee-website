#!/usr/bin/env python3
"""Transition-hash chain tests for build-tee-measurements-registry.py.

Includes the cross-language KNOWN-ANSWER vector: the same document must
produce the same content_hash / transition_hash in Python (the publisher) and
Rust (kubetee-attestation-verifier, tests/phase6_failclosed.rs::
transition_chain_verifies). Run with `python3 -m pytest tests/` or plain
`python3 tests/test_registry_chain.py`.
"""
from __future__ import annotations

import copy
import importlib.util
import json
import sys
from pathlib import Path

SCRIPT = Path(__file__).resolve().parent.parent / "scripts" / "build-tee-measurements-registry.py"
spec = importlib.util.spec_from_file_location("registry_builder", SCRIPT)
rb = importlib.util.module_from_spec(spec)
sys.modules["registry_builder"] = rb
spec.loader.exec_module(rb)

# ---------------------------------------------------------------------------
# KNOWN-ANSWER vector (kept in sync with Rust tests/phase6_failclosed.rs).
# The Rust test derives these from the same document; any divergence between
# the two implementations breaks one of the two tests.
# ---------------------------------------------------------------------------
KAT_DOC = {
    "schema": "kubetee.tee-measurements-registry/1",
    "version": 1,
    "issued_at": "2026-11-27T00:00:00Z",
    "records": [{"id": "r1", "tee": "tdx", "status": "active",
                 "measurements": {"mrtd": "00"}}],
}
KAT_CONTENT_HASH = "3d318863138b6a27f349d62da67edce436b7ce0ae552b3b1875a7fa1599f5760"
KAT_TRANSITION_HASH = "a4352972c6c47ac9234cdd9f332d22c757ebd506352691f7a2eee9b5849a3be5"


def test_kat_content_and_transition_hash():
    """Cross-language KAT: Python must agree with the Rust implementation."""
    c = rb.content_hash(copy.deepcopy(KAT_DOC))
    assert c == KAT_CONTENT_HASH, f"content_hash diverged from Rust KAT: {c}"
    t = rb.transition_hash(c, rb.GENESIS_PREVIOUS)
    assert t == KAT_TRANSITION_HASH, f"transition_hash diverged from Rust KAT: {t}"


def test_genesis_chain_links_from_zeros():
    reg = rb.attach_chain(copy.deepcopy(KAT_DOC), None)
    assert reg["version"] == 1
    chain = reg["chain"]
    assert chain["previous_transition_hash"] == rb.GENESIS_PREVIOUS
    assert chain["content_hash"] == rb.content_hash(reg)  # excludes chain itself
    assert chain["transition_hash"] == rb.transition_hash(
        chain["content_hash"], chain["previous_transition_hash"])
    rb.verify_chain(reg)  # must not raise


def test_linked_history():
    v1 = rb.attach_chain(copy.deepcopy(KAT_DOC), None)
    v2 = rb.attach_chain(copy.deepcopy(KAT_DOC), v1)
    assert v2["version"] == 2
    assert v2["chain"]["previous_transition_hash"] == v1["chain"]["transition_hash"]
    assert v2["chain"]["previous_version"] == 1
    assert "bootstrap" not in v2["chain"]
    rb.verify_chain(v2)


def test_pre_chain_bootstrap():
    """A pre-Phase-6 predecessor (no chain) boots the chain from GENESIS."""
    legacy = copy.deepcopy(KAT_DOC)  # version 1, no chain member
    v2 = rb.attach_chain(copy.deepcopy(KAT_DOC), legacy)
    assert v2["version"] == 2
    assert v2["chain"]["previous_transition_hash"] == rb.GENESIS_PREVIOUS
    assert v2["chain"]["bootstrap"] is True
    rb.verify_chain(v2)


def test_tampered_content_rejected():
    reg = rb.attach_chain(copy.deepcopy(KAT_DOC), None)
    reg["records"][0]["id"] = "r1-tampered"
    try:
        rb.verify_chain(reg)
    except SystemExit:
        return
    raise AssertionError("tampered content must fail verify_chain")


def test_spliced_transition_rejected():
    """A chain whose transition_hash does not reproduce must be rejected."""
    v1 = rb.attach_chain(copy.deepcopy(KAT_DOC), None)
    v2 = rb.attach_chain(copy.deepcopy(KAT_DOC), v1)
    v2["chain"]["transition_hash"] = "ff" * 32
    try:
        rb.verify_chain(v2)
    except SystemExit:
        return
    raise AssertionError("spliced transition must fail verify_chain")


if __name__ == "__main__":
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
            print(f"ok {name}")
    print("all registry-chain tests passed")
