"""Regenerate the four review renders for Leonida Key Art Lab.

The script owns the whole pipeline: it starts the project's static server on a
private port, makes a real headless Chrome open four fixed views, refuses to
capture unless the app's own marker shows up in the rendered document, and then
re-encodes each screenshot as a compact JPEG with Pillow.

Run from anywhere with:  python capture_shots.py
"""
from __future__ import annotations

import os
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

from PIL import Image

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

ROOT = Path(__file__).resolve().parent
SHOT_DIR = ROOT / "screenshots"
TMP_DIR = ROOT / ".capture-tmp"

PORT = 8098
BASE_URL = f"http://127.0.0.1:{PORT}/"
CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"

# Text the app itself puts on the page; a plain 200 response is not enough.
APP_MARKER = "Leonida Key Art Lab"

# The dossier's image cap and the size envelope every capture must respect.
MAX_BYTES = 262144
MAX_LONG_SIDE = 1280
MIN_SHORT_SIDE = 480

VIEWS: list[dict[str, Any]] = [
    {
        "name": "1-cover-portrait.jpg",
        "query": "shot=cover&size=portrait&grade=sunset",
        "width": 1024,
        "height": 1280,
        "description": "portrait cover, sunset grade",
    },
    {
        "name": "2-cover-wide.jpg",
        "query": "shot=cover&size=wide&grade=rain",
        "width": 1280,
        "height": 720,
        "description": "wide cover, rain grade",
    },
    {
        "name": "3-cover-square.jpg",
        "query": "shot=cover&size=square&grade=ink",
        "width": 1080,
        "height": 1080,
        "description": "square variant, ink grade",
    },
    {
        "name": "4-editor.jpg",
        "query": "shot=editor",
        "width": 1280,
        "height": 800,
        "description": "editor with sample photos and filled panels",
    },
]

# Keep every child process off the desktop: no flashing console or browser.
CHROME_FLAGS = getattr(subprocess, "CREATE_NO_WINDOW", 0)
SERVER_FLAGS = CHROME_FLAGS
if os.name == "nt":
    SERVER_FLAGS |= getattr(subprocess, "DETACHED_PROCESS", 0)
    SERVER_FLAGS |= getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def require_inputs() -> None:
    """Fail early with a clear message instead of producing half a set."""
    if not Path(CHROME).is_file():
        raise SystemExit(f"Chrome executable not found: {CHROME}")
    if not (ROOT / "serve.ts").is_file():
        raise SystemExit("serve.ts is missing from the repository root")
    if not (ROOT / "app" / "index.html").is_file():
        raise SystemExit("app/index.html is missing from the repository")


def prepare_directories() -> None:
    """Create a clean output folder and a private scratch folder for Chrome."""
    SHOT_DIR.mkdir(parents=True, exist_ok=True)
    if TMP_DIR.exists():
        shutil.rmtree(TMP_DIR, ignore_errors=True)
    TMP_DIR.mkdir(parents=True, exist_ok=True)


def start_server() -> subprocess.Popen[bytes]:
    """Launch the static server as a hidden, detached background process."""
    return subprocess.Popen(
        ["node", "serve.ts", "--port", str(PORT)],
        cwd=ROOT,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        creationflags=SERVER_FLAGS,
    )


def stop_server(process: subprocess.Popen[bytes]) -> None:
    """Reap the server and any stuck child so no orphan is left behind."""
    if process.poll() is not None:
        return
    process.terminate()
    try:
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait(timeout=5)


def wait_for_server(process: subprocess.Popen[bytes]) -> None:
    """Poll the port until the server answers, with a hard deadline."""
    deadline = time.monotonic() + 30.0
    last_error: BaseException | None = None
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError("the static server exited before it was ready")
        try:
            with urllib.request.urlopen(BASE_URL, timeout=2) as response:
                if response.status == 200:
                    return
        except (urllib.error.URLError, OSError) as exc:
            last_error = exc
        time.sleep(0.25)
    raise RuntimeError(f"the static server never answered: {last_error}")


def check_marker_in_source() -> None:
    """Check the raw page as a first, cheap guard against a wrong directory."""
    with urllib.request.urlopen(BASE_URL, timeout=10) as response:
        page = response.read().decode("utf-8", "replace")
    if APP_MARKER not in page:
        raise RuntimeError("served HTML does not contain the app marker")


def check_marker_in_browser(profile: Path) -> None:
    """Ask Chrome to render the page and dump its DOM, then look for the marker.

    This is deliberately stricter than trusting an HTTP 200: the app has to have
    booted far enough for its own text to be present in the rendered document.
    """
    command = [
        CHROME,
        "--headless=new",
        "--disable-gpu",
        "--virtual-time-budget=8000",
        f"--user-data-dir={profile}",
        "--dump-dom",
        BASE_URL,
    ]
    result = subprocess.run(
        command,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        creationflags=CHROME_FLAGS,
        timeout=120,
        check=True,
    )
    rendered = result.stdout.decode("utf-8", "replace")
    if APP_MARKER not in rendered:
        raise RuntimeError("rendered DOM does not contain the app marker; refusing to capture")
    (TMP_DIR / "dom-check.html").write_text(rendered, encoding="utf-8")


def capture(view: dict[str, Any]) -> Path:
    """Take one raw PNG screenshot of a fixed app view."""
    stem = Path(view["name"]).stem
    raw = TMP_DIR / f"{stem}.png"
    profile = TMP_DIR / f"profile-{stem}"
    command = [
        CHROME,
        "--headless=new",
        "--disable-gpu",
        "--hide-scrollbars",
        "--virtual-time-budget=8000",
        f"--window-size={view['width']},{view['height']}",
        f"--user-data-dir={profile}",
        f"--screenshot={raw}",
        f"{BASE_URL}?{view['query']}",
    ]
    subprocess.run(
        command,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        creationflags=CHROME_FLAGS,
        timeout=120,
        check=True,
    )
    if not raw.is_file() or raw.stat().st_size == 0:
        raise RuntimeError(f"Chrome wrote no screenshot for {view['name']}")
    return raw


def compress_and_verify(raw: Path, name: str) -> None:
    """Re-encode to JPEG within the byte cap and check both size constraints."""
    final = SHOT_DIR / name
    with Image.open(raw) as source:
        image = source.convert("RGB")

    width, height = image.size
    long_side, short_side = max(width, height), min(width, height)
    if long_side > MAX_LONG_SIDE:
        raise RuntimeError(f"{name}: long side {long_side} exceeds {MAX_LONG_SIDE}")
    if short_side < MIN_SHORT_SIDE:
        raise RuntimeError(f"{name}: short side {short_side} is below {MIN_SHORT_SIDE}")

    quality = 92
    while quality >= 24:
        image.save(
            final,
            format="JPEG",
            quality=quality,
            optimize=True,
            progressive=True,
            subsampling=2,
        )
        size = final.stat().st_size
        if size < MAX_BYTES:
            print(f"{name}: {width}x{height} px, {size} bytes, JPEG quality {quality}")
            return
        quality -= 4

    raise RuntimeError(f"{name}: could not fit under {MAX_BYTES} bytes")


def verify_all() -> None:
    """Read back the four final files and confirm every rule one more time."""
    expected = [view["name"] for view in VIEWS]
    actual = sorted(p.name for p in SHOT_DIR.iterdir() if p.is_file())
    if actual != sorted(expected):
        raise RuntimeError(f"screenshots/ holds {actual}, expected {sorted(expected)}")

    for name in expected:
        path = SHOT_DIR / name
        size = path.stat().st_size
        with Image.open(path) as image:
            width, height = image.size
            image.verify()
        if size >= MAX_BYTES or max(width, height) > MAX_LONG_SIDE or min(width, height) < MIN_SHORT_SIDE:
            raise RuntimeError(f"{name}: failed final verification ({width}x{height}, {size} bytes)")
    print("All four screenshots verified under the byte and dimension caps.")


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------


def main() -> int:
    require_inputs()
    prepare_directories()

    server = start_server()
    try:
        wait_for_server(server)
        check_marker_in_source()
        check_marker_in_browser(TMP_DIR / "profile-check")
        for view in VIEWS:
            print(f"Capturing {view['description']} -> {view['name']}")
            raw = capture(view)
            compress_and_verify(raw, view["name"])
        verify_all()
    finally:
        stop_server(server)
        shutil.rmtree(TMP_DIR, ignore_errors=True)

    return 0


if __name__ == "__main__":
    sys.exit(main())
