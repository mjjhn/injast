#!/usr/bin/env python3
"""Run acceptance against an owned API and temporary DB; never stop other processes."""
from __future__ import annotations
import argparse
import json
import os
import re
from pathlib import Path
import socket
import subprocess
import tempfile
import time
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parent.parent

def free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]

def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=["checker", "e2e"])
    parser.add_argument("--evidence-prefix", default="gin")
    args = parser.parse_args()
    prefix = args.evidence_prefix
    if not re.fullmatch(r"[a-zA-Z0-9_-]+", prefix):
        parser.error("evidence prefix must use letters, digits, underscore or hyphen")
    api_port = 4000 if args.mode == "checker" else free_port()
    ui_port = free_port()
    # Refuse an occupied port before any test can reset an unrelated API.
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", api_port))
    base = f"http://127.0.0.1:{api_port}"
    evidence = ROOT / "artifacts/evidence"
    evidence.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="hadaf-acceptance-") as directory:
        env = dict(os.environ, DB_PATH=str(Path(directory)/"test.db"),
                   API_ADDR=f"127.0.0.1:{api_port}", OPS_ADDR="off",
                   CORS_ORIGINS=f"http://127.0.0.1:{ui_port}",
                   E2E_API_URL=base, VITE_API_URL=base, E2E_UI_PORT=str(ui_port),
                   E2E_SCREENSHOTS=str(ROOT/f"artifacts/screenshots/{prefix}-e2e"), CI="1",
                   PLAYWRIGHT_JSON_OUTPUT_NAME=str(evidence/f"{prefix}-playwright.json"))
        with (evidence/f"{prefix}-{args.mode}-api.jsonl").open("wb") as log:
            api = subprocess.Popen([str(ROOT/"backend/bin/api")], cwd=ROOT, env=env, stdout=log, stderr=log)
            try:
                for _ in range(200):
                    if api.poll() is not None:
                        raise RuntimeError(f"owned API exited: {api.returncode}; see API log")
                    try:
                        with urllib.request.urlopen(base+"/api/wallet", timeout=1) as response:
                            assert json.load(response)["availableAmount"] == 25000000
                        break
                    except (urllib.error.URLError, TimeoutError):
                        time.sleep(.05)
                else:
                    raise RuntimeError("API readiness timed out")
                if args.mode == "checker":
                    command, cwd = ["python3", "check_api.py"], ROOT
                else:
                    command, cwd = ["npm", "run", "test:e2e", "--", "--reporter=list,json"], ROOT/"frontend"
                result = subprocess.run(command, cwd=cwd, env=env)
                if result.returncode:
                    raise SystemExit(result.returncode)
            finally:
                if api.poll() is None:
                    api.terminate()
                    try: api.wait(timeout=12)
                    except subprocess.TimeoutExpired:
                        api.kill(); api.wait()
                if api.returncode != 0:
                    print(f"API exit code: {api.returncode}")

if __name__ == "__main__":
    main()
