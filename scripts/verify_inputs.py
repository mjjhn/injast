#!/usr/bin/env python3
"""Verify that the original task brief and acceptance checker are unchanged."""
import hashlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
EXPECTED = {
    "BRIEF.md": "70233ccdeb46d68ebc659bb4cc6c5a0a09970916315f1bba172f1f9457dcc576",
    "check_api.py": "e824cf2c4c3c2970cb3e8cdf68092f418ddaa1e71a8e209d6181cb0760949d90",
}
for name, expected in EXPECTED.items():
    actual = hashlib.sha256((ROOT / name).read_bytes()).hexdigest()
    if actual != expected:
        raise SystemExit(f"FAIL: original input changed: {name}")
    print(f"PASS {name} {actual}")
