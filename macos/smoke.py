#!/usr/bin/env python3
"""Run the archived standalone app twice using a temporary music library."""
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import wave

with tempfile.TemporaryDirectory(prefix="noise-archive-") as unpacked, \
        tempfile.TemporaryDirectory(prefix="noise-smoke-", dir="/tmp") as profile:
    subprocess.run(["ditto", "-x", "-k", sys.argv[1], unpacked], check=True)
    bundle = Path(unpacked) / "Noise Music.app"
    subprocess.run(["codesign", "--verify", "--deep", "--strict", bundle], check=True)
    audio = Path(profile) / "profile/apps/spotify/audio"
    audio.mkdir(parents=True)
    with wave.open(str(audio / "Noise fixture.wav"), "wb") as fixture:
        fixture.setparams((1, 2, 44100, 0, "NONE", "not compressed"))
        fixture.writeframes(bytes(44100 * 2 * 15))
    environment = {**os.environ, "NOISE_SMOKE_DIR": profile}
    executable = bundle / "Contents/MacOS/Electron"
    for args in ([], ["--smoke-restore"]):
        subprocess.run([executable, "--smoke-test", *args], env=environment, check=True, timeout=90)
    if len(sys.argv) > 2:
        Path(sys.argv[2]).write_bytes((Path(profile) / "music.png").read_bytes())
