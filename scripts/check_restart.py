#!/usr/bin/env python3
"""Verify persistence across a real API process stop/start, using disposable data.

Build backend/bin/api first, then run python3 scripts/check_restart.py.
This does not use /api/reset and does not touch the main development database.
"""
from __future__ import annotations

import argparse
import concurrent.futures
import signal
import sqlite3
import json
import os
from pathlib import Path
import subprocess
import tempfile
import time
import urllib.error
import urllib.request


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--api-bin", default="backend/bin/api")
    parser.add_argument("--port", type=int, default=4011)
    args = parser.parse_args()
    executable = str(Path(args.api_bin).resolve())
    base = f"http://127.0.0.1:{args.port}/api"

    def request(path: str, body: dict | None = None, key: str | None = None) -> dict:
        headers = {"Content-Type": "application/json"}
        if key:
            headers["Idempotency-Key"] = key
        req = urllib.request.Request(
            base + path,
            data=json.dumps(body).encode() if body is not None else None,
            headers=headers,
            method="POST" if body is not None else "GET",
        )
        with urllib.request.urlopen(req, timeout=5) as response:
            return json.load(response)

    with tempfile.TemporaryDirectory(prefix="hadaf-restart-") as directory:
        environment = dict(os.environ, DB_PATH=str(Path(directory) / "data.db"), API_ADDR=f"127.0.0.1:{args.port}", OPS_ADDR="off")
        process: subprocess.Popen | None = None
        with open(Path(directory) / "api.log", "wb") as log:
            def start() -> subprocess.Popen:
                proc = subprocess.Popen([executable], env=environment, stdout=log, stderr=log)
                # Do not accept an unrelated service already occupying the test port.
                time.sleep(0.1)
                for _ in range(100):
                    if proc.poll() is not None:
                        raise RuntimeError("API failed to start; check executable and free test port")
                    try:
                        request("/wallet")
                        return proc
                    except (urllib.error.URLError, TimeoutError):
                        time.sleep(0.05)
                proc.terminate()
                proc.wait(timeout=5)
                raise RuntimeError("API did not become ready")

            try:
                process = start()
                original = request("/goals/book/deposits", {"amount": 500000}, "restart-book")
                original_trip = request("/goals/trip/deposits", {"amount": 1000}, "restart-trip")
                request("/goals/trip/cancel", {})
                before = {"wallet": request("/wallet"), "active": request("/goals?status=active"), "completed": request("/goals?status=completed")}
                process.kill()  # Committed SQLite state must survive even abrupt exit.
                process.wait(timeout=5)
                process = start()
                after = {"wallet": request("/wallet"), "active": request("/goals?status=active"), "completed": request("/goals?status=completed")}
                assert before == after, "wallet or goals changed across restart"
                assert request("/goals/book/deposits", {"amount": 500000}, "restart-book") == original
                assert request("/goals/trip/deposits", {"amount": 1000}, "restart-trip") == original_trip
                assert request("/wallet") == before["wallet"], "replay debited again"
                # Graceful shutdown with an in-flight financial request waiting
                # behind an external writer. Commit must finish before process exit.
                with sqlite3.connect(environment["DB_PATH"], isolation_level=None) as lock:
                    lock.execute("BEGIN IMMEDIATE")
                    with concurrent.futures.ThreadPoolExecutor() as pool:
                        transfer = pool.submit(request, "/goals/laptop/deposits", {"amount": 1000}, "shutdown-inflight")
                        time.sleep(.1)
                        assert not transfer.done(), "request did not wait behind writer"
                        process.send_signal(signal.SIGTERM)
                        time.sleep(.1)
                        lock.execute("ROLLBACK")
                        inflight = transfer.result(timeout=5)
                        process.wait(timeout=12)
                        assert process.returncode == 0, "SIGTERM exit was not clean"
                process = start()
                assert request("/goals/laptop/deposits", {"amount": 1000}, "shutdown-inflight") == inflight
                assert request("/wallet")["availableAmount"] == before["wallet"]["availableAmount"] - 1000
                print(json.dumps({"status": "PASS", "stop": "SIGKILL then new process, same SQLite file", "wallet": after["wallet"], "activeCount": len(after["active"]["goals"]), "completedCount": len(after["completed"]["goals"]), "identicalReplayAfterCompletionAndDeletion": True, "gracefulSIGTERMWithInflightDeposit": True, "resetUsed": False}, ensure_ascii=False, indent=2))
            finally:
                if process is not None and process.poll() is None:
                    process.terminate()
                    process.wait(timeout=5)


if __name__ == "__main__":
    main()
