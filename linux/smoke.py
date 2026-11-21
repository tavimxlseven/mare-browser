#!/usr/bin/env python3
"""Test the installed .deb with real Chromium sandboxing and a disposable profile."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory(prefix="compass-smoke-", dir="/tmp") as temporary:
    directory = Path(temporary)
    config = directory / "alsa.conf"
    config.write_text('pcm.!default { type null }\nctl.!default { type hw card 0 }\n')
    environment = {**os.environ, "COMPASS_SMOKE_DIR": temporary, "ALSA_CONFIG_PATH": str(config)}
    result = subprocess.run(["/usr/bin/compass-browser", "--smoke-test", "--disable-gpu"], env=environment, timeout=110, capture_output=True, text=True)
    destination = ROOT / "dist"
    destination.mkdir(exist_ok=True)
    for name, output in [("result.json", "ubuntu-smoke.json"), ("screenshot.png", "ubuntu-smoke.png")]:
        if (directory / name).exists():
            shutil.copyfile(directory / name, destination / output)
    report = json.loads((directory / "result.json").read_text()) if (directory / "result.json").exists() else {"success": False, "error": "No report", "stderr": result.stderr[-6000:]}
    print(json.dumps(report, indent=2))
    if result.returncode or not report["success"]:
        raise SystemExit(result.returncode or 1)
