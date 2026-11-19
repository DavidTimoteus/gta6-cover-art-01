#!/usr/bin/env python3
"""Rebuild the four saved proof images for Leonida Key Art Lab.

The script brings up the local static server quietly, asks headless Chrome to
render four states of the editor, and turns each capture into a compact JPEG.
It refuses to continue unless the downloaded page carries the app's own text,
so a bare 200 response from a wrong or half-started server cannot fool it.
Everything it spawns is shut down before the process exits.
"""

from __future__ import annotations

import io
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

from PIL import Image

# Chrome lives at a fixed location on this machine; no bundled browser is used.
CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
PORT = 8098
BASE = f"http://127.0.0.1:{PORT}"
ROOT = Path(__file__).resolve().parent
SHOT_DIR = ROOT / "screenshots"

# Limits the dossier enforces on each submitted image.
MAX_BYTES = 262_144
MAX_SIDE = 1280
MIN_SIDE = 480

# The first string is in the page shell; the second is injected by the editor's
# JavaScript, so finding it in a rendered DOM proves the app really booted.
PAGE_MARKER = "LEONIDA KEY ART LAB"
TYPE_MARKER = "COPPER HALO"
DOM_MARKER = "Face-aware auto crop"

# Windows flags that keep the server off the visible desktop.
CREATE_NO_WINDOW = 0x08000000
DETACHED_PROCESS = 0x00000008

# target sizes are the pre-compression window sizes; grade and layout come from
# the editor's own query-string modes.
VIEWS = (
    {
        "file": "1-cover-portrait.jpg",
        "query": "shot=cover&size=portrait&grade=sunset",
        "size": (1024, 1280),
        "label": "portrait cover, sunset grade",
    },
    {
        "file": "2-cover-wide.jpg",
        "query": "shot=cover&size=wide&grade=rain",
        "size": (1280, 720),
        "label": "wide cover, rain grade",
    },
    {
        "file": "3-cover-square.jpg",
        "query": "shot=cover&size=square&grade=ink",
        "size": (1080, 1080),
        "label": "square cover, ink grade",
    },
    {
        "file": "4-editor.jpg",
        "query": "shot=editor",
        "size": (1280, 800),
        "label": "editor with samples loaded and panels filled",
    },
)

# Tried in order; the first encoding that fits under the byte ceiling wins.
QUALITY_STEPS = (92, 88, 84, 80, 76, 72, 68, 64, 60, 56, 52, 48, 44, 40, 36, 32)


def log(message: str) -> None:
    """Print progress immediately so a failure is easy to place."""
    print(message, flush=True)


def fetch_page() -> str | None:
    """Return the served page text, or None when nothing answered yet."""
    try:
        with urllib.request.urlopen(BASE, timeout=3) as response:
            raw = response.read()
    except Exception:
        return None
    return raw.decode("utf-8", errors="replace")


def has_app_text(html: str | None) -> bool:
    """Check for the editor's signature words, not merely an HTTP status."""
    if html is None:
        return False
    return PAGE_MARKER in html and TYPE_MARKER in html


def wait_for_app(timeout: float = 45.0) -> None:
    """Poll until the real editor page is being served with its marker text."""
    deadline = time.monotonic() + timeout
    attempt = 0
    while time.monotonic() < deadline:
        attempt += 1
        if has_app_text(fetch_page()):
            log(f"server ready: marker text found after {attempt} probe(s)")
            return
        time.sleep(0.4)
    raise RuntimeError("server answered without the app's marker text")


def start_server() -> subprocess.Popen:
    """Launch serve.ts with no console window and no inherited console handles."""
    kwargs: dict = {
        "cwd": str(ROOT),
        "stdin": subprocess.DEVNULL,
        "stdout": subprocess.DEVNULL,
        "stderr": subprocess.DEVNULL,
    }
    if sys.platform == "win32":
        kwargs["creationflags"] = CREATE_NO_WINDOW | DETACHED_PROCESS
    else:
        kwargs["start_new_session"] = True
    return subprocess.Popen(["node", "serve.ts", "--port", str(PORT)], **kwargs)


def stop_server(process: subprocess.Popen) -> None:
    """Always terminate the server and reap it, even on an interrupted run."""
    if process.poll() is not None:
        return
    process.terminate()
    try:
        process.wait(timeout=8)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait(timeout=8)


def chrome_flags(profile: str) -> list[str]:
    """Flags shared by the marker probe and all four screenshots."""
    return [
        CHROME,
        "--headless=new",
        "--disable-gpu",
        "--hide-scrollbars",
        "--virtual-time-budget=8000",
        "--force-device-scale-factor=1",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-extensions",
        f"--user-data-dir={profile}",
    ]


def rendered_app_ok(profile: str) -> bool:
    """Render the editor DOM and look for a control that JavaScript creates."""
    command = chrome_flags(profile) + ["--dump-dom", f"{BASE}/?shot=editor"]
    try:
        result = subprocess.run(command, capture_output=True, timeout=90)
    except subprocess.TimeoutExpired:
        return False
    if result.returncode != 0:
        return False
    return DOM_MARKER in result.stdout.decode("utf-8", errors="replace")


def capture_raw(view: dict, profile: str, raw_dir: Path) -> Path:
    """Ask Chrome to paint one view into a PNG inside the scratch directory."""
    target = raw_dir / f"{Path(view['file']).stem}.png"
    url = f"{BASE}/?{view['query']}"
    width, height = view["size"]
    command = chrome_flags(profile) + [
        f"--window-size={width},{height}",
        f"--screenshot={target}",
        url,
    ]
    result = subprocess.run(command, capture_output=True, timeout=120)
    if result.returncode != 0 or not target.is_file():
        detail = result.stderr.decode("utf-8", errors="replace")[-600:]
        raise RuntimeError(f"Chrome failed for {view['file']}: {detail}")
    log(f"captured {view['file']} from {url}")
    return target


def checked_size(view: dict) -> tuple[int, int]:
    """Clamp a target so the long edge fits and the short edge stays legible."""
    width, height = view["size"]
    if max(width, height) > MAX_SIDE or min(width, height) < MIN_SIDE:
        raise ValueError(f"target size {width}x{height} breaks the image limits")
    return width, height


def encode_jpeg(image: Image.Image) -> tuple[bytes, int]:
    """Shrink quality until the encoded JPEG fits dossier's per-image ceiling."""
    for quality in QUALITY_STEPS:
        buffer = io.BytesIO()
        image.save(
            buffer,
            format="JPEG",
            quality=quality,
            optimize=True,
            progressive=True,
            subsampling=2,
        )
        data = buffer.getvalue()
        if len(data) <= MAX_BYTES:
            return data, quality
    raise RuntimeError("even the lowest quality did not fit the byte ceiling")


def finish_shot(view: dict, raw: Path) -> tuple[int, int, int, int]:
    """Resize to the intended dimensions, compress, validate and save."""
    width, height = checked_size(view)
    with Image.open(raw) as source:
        sheet = source.convert("RGB")
    if sheet.size != (width, height):
        sheet = sheet.resize((width, height), Image.Resampling.LANCZOS)

    data, quality = encode_jpeg(sheet)
    destination = SHOT_DIR / view["file"]
    destination.write_bytes(data)

    with Image.open(destination) as check:
        actual = check.size
        check.load()
    real_bytes = destination.stat().st_size

    if max(actual) > MAX_SIDE or min(actual) < MIN_SIDE:
        raise RuntimeError(f"{view['file']} has out-of-range dimensions: {actual}")
    if real_bytes > MAX_BYTES:
        raise RuntimeError(f"{view['file']} is too large: {real_bytes} bytes")
    return actual[0], actual[1], real_bytes, quality


def main() -> int:
    """Capture, compress and verify all four shots, then clean up."""
    SHOT_DIR.mkdir(parents=True, exist_ok=True)
    server = start_server()
    try:
        wait_for_app()
        with tempfile.TemporaryDirectory(prefix="leonida-shots-") as scratch:
            scratch_dir = Path(scratch)
            profile = str(scratch_dir / "chrome-profile")
            raw_dir = scratch_dir / "raw"
            raw_dir.mkdir(parents=True, exist_ok=True)

            if not rendered_app_ok(profile):
                raise RuntimeError("rendered page did not contain the editor marker")
            log("rendered DOM confirmed: editor controls are present")

            for view in VIEWS:
                raw = capture_raw(view, profile, raw_dir)
                width, height, size, quality = finish_shot(view, raw)
                log(
                    f"{view['file']} ({view['label']}): "
                    f"{width}x{height}, {size} bytes, JPEG quality {quality}"
                )
    finally:
        stop_server(server)
        log("server stopped; scratch files removed")

    log(f"done: {len(VIEWS)} verified images in {SHOT_DIR}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(f"capture failed: {error}", file=sys.stderr, flush=True)
        raise SystemExit(1)
