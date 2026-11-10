#!/usr/bin/env python3
"""Install/build/test a source-only copy using this host's toolchain and caches."""
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
ROOT=Path(__file__).resolve().parent.parent
with tempfile.TemporaryDirectory(prefix="hadaf-clean-") as directory:
    target=Path(directory)/"source"
    shutil.copytree(ROOT,target,ignore=shutil.ignore_patterns(".git","node_modules","bin","dist","data","*.db","*.db-wal","*.db-shm","playwright-report","test-results",".clean-verification","*.tsbuildinfo","artifacts"))
    go=os.environ.get("GO","go")
    subprocess.run([go,"mod","download"],cwd=target/"backend",check=True)
    subprocess.run([go,"mod","verify"],cwd=target/"backend",check=True)
    subprocess.run([go,"test","./..."],cwd=target/"backend",check=True)
    subprocess.run([go,"build","-buildvcs=false","-o","bin/api","./cmd/api"],cwd=target/"backend",check=True)
    subprocess.run(["npm","ci","--ignore-scripts","--prefer-offline"],cwd=target/"frontend",check=True)
    subprocess.run(["npm","test"],cwd=target/"frontend",check=True)
    subprocess.run(["npm","run","build"],cwd=target/"frontend",check=True)
    subprocess.run(["python3","scripts/verify_inputs.py"],cwd=target,check=True)
    print("PASS source-only clean-copy install/build/test; same host toolchain and package caches, not a fresh VM")
