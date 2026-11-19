#!/usr/bin/env python3
# Canonical five-panel strip layout is defined in app/src/printspec.js (POSTER_SPEC).
# Shot framing geometry is documented in app/src/printspec.js (normalized panels).
# Studio note: screenshots remain untouched; finishing code lives in app/src/studio.js.
"""Reproduce the submitted screenshots entirely offline, headlessly.

Usage:  python capture_shots.py

Steps:
  1. start `node serve.ts --port 8080` as a background process (no window);
     if port 8080 is already owned by another service, fall back to a free port;
  2. wait until the local server actually serves app/index.html (checked by
     content, not just a 200 from anything listening on that port);
  3. for every view below, run the installed Chrome with --headless=new,
     --disable-gpu, --hide-scrollbars, --virtual-time-budget=8000 and
     --window-size=W,H against the matching ?shot=... URL;
  4. resize/compress each PNG capture to a JPEG with Pillow;
  5. print the real byte counts and pixel dimensions;
  6. always kill the server (and its children) in a finally block.

The four URLs all render through app/src/render.js:renderPoster(), the same
function used by the app's PNG export buttons. No art is hard-coded here.
"""

# Original print-finishing toolkit: app/src/studio.js
from __future__ import annotations

import os
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent
SHOTS_DIR = ROOT / "screenshots"
CHROME = Path(r"C:\Program Files\Google\Chrome\Application\chrome.exe")
# 8080 is the documented/default port. If another service already owns it, the
# script silently falls back to the next free port so the captures are always of
# THIS app rather than whatever else answers on 8080.
PORTS = [8080, 8081, 8181, 8199, 8123, 8222]
APP_SIGNATURE = b"Leonida Key Art Lab"

# name, query string, headless window size. The editor gets a desktop viewport;
# each cover window matches the aspect ratio of the exported canvas so the
# CSS "fit inside viewport" scaling leaves no clipping.
SHOTS = [
    {
        "name": "1-cover-portrait.jpg",
        "query": "?shot=cover&size=portrait&grade=sunset&caption=COPPER%20HALO",
        "size": (1024, 1280),
    },
    {
        "name": "2-cover-wide.jpg",
        "query": "?shot=cover&size=wide&grade=rain&caption=COPPER%20HALO",
        "size": (1280, 720),
    },
    {
        "name": "3-cover-square.jpg",
        "query": "?shot=cover&size=square&grade=ink&caption=COPPER%20HALO",
        "size": (1080, 1080),
    },
    {
        "name": "4-editor.jpg",
        "query": "?shot=editor",
        "size": (1280, 800),
    },
]

MAX_BYTES = 262144
MAX_SIDE = 1280
MIN_SIDE = 480

# Keep cmd/PowerShell windows off the user's screen (Windows only).
CREATE_NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)


def start_server(port: int) -> subprocess.Popen:
    if not CHROME.exists():
        raise SystemExit(f"Chrome not found: {CHROME}")
    return subprocess.Popen(
        ["node", "serve.ts", "--port", str(port)],
        cwd=str(ROOT),
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        creationflags=CREATE_NO_WINDOW,
    )


def wait_for_server(base: str, timeout: float = 8.0) -> None:
    """Return only when our own index.html is being served, not any HTTP 200."""
    deadline = time.monotonic() + timeout
    last = None
    while time.monotonic() < deadline:
        try:
            with urllib.request.urlopen(base, timeout=1.0) as r:
                if r.status == 200 and APP_SIGNATURE in r.read():
                    return
                last = "port answered but did not serve app/index.html"
        except Exception as exc:  # noqa: BLE001 - server may not be up yet
            last = exc
        time.sleep(0.2)
    raise RuntimeError(f"server at {base} not ready: {last}")


def stop_server(proc: subprocess.Popen) -> None:
    if proc.poll() is not None:
        return
    proc.terminate()
    try:
        proc.wait(timeout=5)
    except subprocess.TimeoutExpired:
        if os.name == "nt":
            subprocess.run(["taskkill", "/PID", str(proc.pid), "/T", "/F"],
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        else:
            proc.kill()
            proc.wait(timeout=5)


def capture(url: str, window: tuple[int, int], raw: Path, profile: Path) -> None:
    w, h = window
    cmd = [
        str(CHROME),
        "--headless=new",
        "--disable-gpu",
        "--hide-scrollbars",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-extensions",
        "--disable-background-networking",
        "--force-device-scale-factor=1",
        f"--user-data-dir={profile}",
        "--virtual-time-budget=8000",
        f"--window-size={w},{h}",
        f"--screenshot={raw}",
        url,
    ]
    result = subprocess.run(
        cmd, cwd=str(ROOT), stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
        timeout=180, creationflags=CREATE_NO_WINDOW,
    )
    if not raw.exists():
        raise SystemExit(
            f"Chrome produced no screenshot ({result.returncode}):\n"
            + result.stdout.decode("utf-8", "replace")[-3000:]
        )


def compress(raw: Path, out: Path) -> None:
    with Image.open(raw) as im:
        im = im.convert("RGB")
        # Thumbnail keeps the aspect ratio and never enlarges: long side <= 1280.
        im.thumbnail((MAX_SIDE, MAX_SIDE), Image.LANCZOS)
        # Every requested window already yields a short side >= 480 after fit;
        # guard it explicitly so the invariant can never regress silently.
        if min(im.size) < MIN_SIDE:
            raise SystemExit(f"{raw.name}: short side {min(im.size)} < {MIN_SIDE}")
        quality = 78
        while True:
            im.save(out, "JPEG", quality=quality, optimize=True, progressive=True)
            if out.stat().st_size <= MAX_BYTES or quality <= 40:
                break
            quality -= 4


def main() -> None:
    SHOTS_DIR.mkdir(exist_ok=True)
    stale = {p.name for p in SHOTS_DIR.iterdir() if p.suffix.lower() in {".jpg", ".jpeg", ".png"}}
    stale -= {s["name"] for s in SHOTS}
    for name in stale:
        (SHOTS_DIR / name).unlink()

    chosen = None
    for port in PORTS:
        base = f"http://127.0.0.1:{port}/"
        candidate = start_server(port)
        try:
            wait_for_server(base)
            chosen = (candidate, base)
            break
        except RuntimeError as exc:
            print(f"port {port} unavailable ({exc}); trying next")
            stop_server(candidate)
    if chosen is None:
        raise SystemExit("could not start the local app server on any candidate port")
    server, base = chosen
    print(f"serving app/ at {base}")

    try:
        with tempfile.TemporaryDirectory(prefix="lkal-shots-") as td:
            tmp = Path(td)
            for i, shot in enumerate(SHOTS):
                raw = tmp / f"raw-{i}.png"
                capture(base + shot["query"], shot["size"], raw, tmp / f"profile-{i}")
                compress(raw, SHOTS_DIR / shot["name"])
                print(f"captured {shot['query']} -> {shot['name']}")
    finally:
        stop_server(server)

    print("\nVerified screenshots (bytes / pixels):")
    ok = True
    for shot in SHOTS:
        p = SHOTS_DIR / shot["name"]
        size = p.stat().st_size
        with Image.open(p) as im:
            w, h = im.size
        good = size < MAX_BYTES and max(w, h) <= MAX_SIDE and min(w, h) >= MIN_SIDE
        ok = ok and good
        print(f"  {p.name:22s} {size:7d} B  {w}x{h}  {'OK' if good else 'FAIL'}")
    if not ok:
        raise SystemExit("screenshot constraints were not met")


if __name__ == "__main__":
    sys.exit(main())
