#!/usr/bin/env python3
"""Assert real-binary startup failure contracts using owned ports and temporary DBs."""
from __future__ import annotations
import argparse
import hashlib
import json
import os
from pathlib import Path
import signal
import socket
import sqlite3
import subprocess
import tempfile
import time
import urllib.request


def reserve():
    sock = socket.socket()
    sock.bind(("127.0.0.1", 0))
    sock.listen()
    return sock


def free_address():
    with reserve() as sock:
        return f"127.0.0.1:{sock.getsockname()[1]}"


def assert_free(address):
    host, port = address.rsplit(":", 1)
    with socket.socket() as sock:
        # Like Go net.Listen, permit reuse of a closed listener in TIME_WAIT.
        # A still-listening socket on the address continues to reject this bind.
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        sock.bind((host, int(port)))


def records(output):
    parsed = [json.loads(line) for line in output.splitlines() if line.strip()]
    assert parsed, "no structured logs"
    for record in parsed:
        assert record["time"].endswith("Z"), record
        assert "PRIVATE" not in json.dumps(record), "private cause/configuration leaked"
    return parsed


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--api-bin", default="backend/bin/api")
    args = parser.parse_args()
    binary = str(Path(args.api_bin).resolve())
    results = []
    with tempfile.TemporaryDirectory(prefix="hadaf-startup-") as directory:
        root = Path(directory)
        for case in ["bad_log_level", "unsafe_ops", "bad_db", "unknown_schema", "api_occupied", "ops_occupied"]:
            api, ops = free_address(), free_address()
            path = root / f"PRIVATE-{case}.db"
            env = dict(os.environ, API_ADDR=api, OPS_ADDR=ops, DB_PATH=str(path), LOG_LEVEL="info", TZ="Asia/Tehran")
            held = None
            expected_stage, expected_reason = "configuration", "invalid"
            before = None
            if case == "bad_log_level":
                env["LOG_LEVEL"] = "PRIVATE_INVALID_LEVEL"
            elif case == "unsafe_ops":
                env["OPS_ADDR"] = "0.0.0.0:4001"
            elif case == "bad_db":
                path.mkdir()
                expected_stage, expected_reason = "storage_open", "io"
            elif case == "unknown_schema":
                with sqlite3.connect(path) as db:
                    db.execute("PRAGMA user_version=99")
                before = hashlib.sha256(path.read_bytes()).hexdigest()
                expected_stage, expected_reason = "storage_open", "unknown"
            else:
                held = reserve()
                occupied = f"127.0.0.1:{held.getsockname()[1]}"
                env["API_ADDR" if case == "api_occupied" else "OPS_ADDR"] = occupied
                expected_stage = "api_listen" if case == "api_occupied" else "ops_listen"
                expected_reason = "address_in_use"
            try:
                process = subprocess.Popen([binary], env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
                try:
                    out, err = process.communicate(timeout=8)
                except subprocess.TimeoutExpired:
                    process.kill(); process.communicate()
                    raise AssertionError(f"startup hung: {case}")
                assert process.returncode == 1, (case, process.returncode)
                assert err == "", (case, err)
                logs = records(out)
                assert not any(r["msg"] == "startup_ready" for r in logs), case
                failure = [r for r in logs if r["msg"] == "startup_or_runtime_failed"]
                assert len(failure) == 1, case
                assert failure[0]["stage"] == expected_stage and failure[0]["reason"] == expected_reason, (case, failure)
                if before:
                    assert hashlib.sha256(path.read_bytes()).hexdigest() == before, "unknown schema file changed"
                if case in ["bad_log_level", "unsafe_ops"]:
                    assert not path.exists(), "invalid configuration touched DB"
            finally:
                if held: held.close()
            # Includes the partial-startup API listener in the ops failure case.
            assert_free(api); assert_free(ops)
            if case in ["api_occupied", "ops_occupied"]: assert_free(occupied)
            results.append({"case":case, "exit":1, "stage":expected_stage, "reason":expected_reason, "status":"PASS", "logs":logs})
        # Positive control: ready listener, API and clean SIGTERM exit from same binary.
        api, ops = free_address(), free_address()
        env = dict(os.environ, API_ADDR=api, OPS_ADDR=ops, DB_PATH=str(root/"healthy.db"), LOG_LEVEL="info", TZ="Asia/Tehran")
        process = subprocess.Popen([binary], env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        try:
            for _ in range(150):
                assert process.poll() is None, "healthy process exited"
                try:
                    with urllib.request.urlopen("http://"+ops+"/health/ready", timeout=.5) as response:
                        if response.status == 200: break
                except OSError: time.sleep(.02)
            else: raise AssertionError("healthy startup timed out")
            with urllib.request.urlopen("http://"+api+"/api/wallet", timeout=2) as response:
                assert json.load(response)["availableAmount"] == 25000000
            process.send_signal(signal.SIGTERM)
            out, err = process.communicate(timeout=12)
            assert process.returncode == 0 and not err, (process.returncode, err)
            logs = records(out)
            assert any(r["msg"] == "startup_ready" for r in logs)
            assert any(r["msg"] == "shutdown_complete" and r["clean"] for r in logs)
        finally:
            if process.poll() is None: process.kill(); process.communicate()
        assert_free(api); assert_free(ops)
        results.append({"case":"healthy_SIGTERM", "exit":0, "status":"PASS", "logs":logs})
    print(json.dumps({"status":"PASS", "cases":results, "data":"temporary only", "UTC_logs":True}, indent=2))

if __name__ == "__main__":
    main()
