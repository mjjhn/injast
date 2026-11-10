#!/usr/bin/env python3
"""Bounded local API latency comparison; not a production capacity benchmark."""
import argparse
import concurrent.futures
import json
import os
from pathlib import Path
import socket
import sqlite3
import statistics
import subprocess
import tempfile
import time
import urllib.request


def measure(binary, samples):
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0)); port=sock.getsockname()[1]
    base=f"http://127.0.0.1:{port}/api"
    with tempfile.TemporaryDirectory(prefix="hadaf-bench-") as directory:
        path=str(Path(directory)/"db.sqlite")
        env=dict(os.environ, API_ADDR=f"127.0.0.1:{port}", OPS_ADDR="off", DB_PATH=path)
        with open(Path(directory)/"api.log", "wb") as log:
            process=subprocess.Popen([str(Path(binary).resolve())], env=env, stdout=log, stderr=log)
            def request(route, body=None, key=None):
                headers={"Content-Type":"application/json"}
                if key: headers["Idempotency-Key"]=key
                req=urllib.request.Request(base+route, data=json.dumps(body).encode() if body is not None else None, headers=headers)
                with urllib.request.urlopen(req, timeout=8) as response: return response.read()
            try:
                for _ in range(200):
                    if process.poll() is not None: raise RuntimeError("API startup failed")
                    try: request("/wallet"); break
                    except OSError: time.sleep(.02)
                result={}
                for operation in ["read","deposit","replay"]:
                    timings=[]
                    for i in range(samples):
                        start=time.perf_counter()
                        if operation=="read": request("/wallet")
                        else: request("/goals/laptop/deposits",{"amount":1},f"bench-{i}" if operation=="deposit" else "bench-0")
                        timings.append((time.perf_counter()-start)*1000)
                    ordered=sorted(timings)
                    result[operation]={"n":samples,"median_ms":round(statistics.median(timings),3),"p95_ms":round(ordered[int((samples-1)*.95)],3),"errors":0}
                # Hold an independent SQLite writer. Release after 400 ms while a
                # completed key is replayed over real HTTP.
                with sqlite3.connect(path, isolation_level=None) as lock:
                    lock.execute("BEGIN IMMEDIATE")
                    with concurrent.futures.ThreadPoolExecutor() as pool:
                        start=time.perf_counter()
                        future=pool.submit(request,"/goals/laptop/deposits",{"amount":1},"bench-0")
                        time.sleep(.4)
                        finished_before_unlock=future.done()
                        lock.execute("ROLLBACK")
                        future.result()
                        result["locked_writer_replay"]={"completed_before_unlock":finished_before_unlock,"observed_total_ms":round((time.perf_counter()-start)*1000,3),"lock_ms":400}
                return result
            finally:
                if process.poll() is None: process.terminate(); process.wait(timeout=12)
                if process.returncode: raise RuntimeError(f"unclean API exit {process.returncode}")

if __name__=="__main__":
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--baseline")
    parser.add_argument("--current",default="backend/bin/api")
    parser.add_argument("--samples",type=int,default=50)
    args=parser.parse_args()
    output={"kind":"local sequential warm-process HTTP sample, temporary DB, no capacity claim"}
    if args.baseline: output["baseline"]=measure(args.baseline,args.samples)
    output["current"]=measure(args.current,args.samples)
    print(json.dumps(output,indent=2))
