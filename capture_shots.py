#!/usr/bin/env python3
"""Produce the four deterministic marketing screenshots for Leonida Key Art Lab.

The script is deliberately self-contained. It starts the project's own static
server on a private port, refuses to proceed until the served HTML proves it is
the key-art app (by containing its brand marker), drives headless Chrome once
per view, and finally re-encodes every capture as a small JPEG inside
``screenshots/``. Nothing here reaches the internet.

Run with:  python capture_shots.py
"""

from __future__ import annotations

import io
import os
import subprocess
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path

from PIL import Image, ImageOps

# ---------------------------------------------------------------------------
# Fixed configuration. These values are kept in one place so a re-run always
# produces the same four files with the same names and the same aspect ratios.
# ---------------------------------------------------------------------------

ROOT = Path(__file__).resolve().parent
SHOT_DIR = ROOT / "screenshots"

PORT = 8097
BASE_URL = f"http://127.0.0.1:{PORT}/"

CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
MARKER = "Leonida Key Art Lab"
SECONDARY_MARKER = 'id="stage"'

MAX_BYTES = 262_144
STARTUP_TIMEOUT = 30.0
CAPTURE_TIMEOUT = 120

# label, query string, capture width, capture height, final width, final height
VIEWS = [
    (
        "1-wide-hero.jpg",
        "shot=cover&size=wide&grade=sunset",
        1280,
        720,
        1280,
        720,
    ),
    (
        "2-portrait.jpg",
        "shot=cover&size=portrait&grade=rain",
        1024,
        1280,
        1024,
        1280,
    ),
    (
        "3-square.jpg",
        "shot=cover&size=square&grade=ink",
        1080,
        1080,
        1080,
        1080,
    ),
    (
        "4-editor.jpg",
        "shot=editor",
        1280,
        800,
        1280,
        800,
    ),
]


# ---------------------------------------------------------------------------
# Process helpers
# ---------------------------------------------------------------------------


def hidden_flags() -> int:
    """Windows flags that keep every child process off the user's screen."""
    flags = 0
    if os.name == "nt":
        flags |= getattr(subprocess, "CREATE_NO_WINDOW", 0)
        flags |= getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)
    return flags


def start_server(log_path: Path) -> subprocess.Popen:
    """Launch ``node serve.ts`` in the background, logging to a temp file."""
    command = ["node", "serve.ts", "--port", str(PORT)]
    with log_path.open("wb") as log:
        return subprocess.Popen(
            command,
            cwd=ROOT,
            stdin=subprocess.DEVNULL,
            stdout=log,
            stderr=subprocess.STDOUT,
            creationflags=hidden_flags(),
        )


def stop_server(process: subprocess.Popen) -> None:
    """Always reap the server, even when a later step has already failed."""
    if process.poll() is not None:
        return
    process.terminate()
    try:
        process.wait(timeout=10)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait(timeout=10)


# ---------------------------------------------------------------------------
# Readiness gate — a 200 response alone is not enough
# ---------------------------------------------------------------------------


def wait_for_app(process: subprocess.Popen, log_path: Path) -> None:
    """Poll until the HTML contains the app's own marker text."""
    deadline = time.monotonic() + STARTUP_TIMEOUT
    last_problem = "no response yet"

    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError("static server exited before becoming ready")

        try:
            with urllib.request.urlopen(BASE_URL, timeout=2) as response:
                if response.status != 200:
                    last_problem = f"HTTP {response.status}"
                    time.sleep(0.25)
                    continue
                body = response.read().decode("utf-8", errors="ignore")

            if MARKER in body and SECONDARY_MARKER in body:
                print(f"[server] ready on {BASE_URL} (marker verified)")
                return
            last_problem = "marker text or preview canvas missing"
        except (urllib.error.URLError, OSError, TimeoutError) as exc:
            last_problem = str(exc)

        time.sleep(0.25)

    tail = ""
    if log_path.exists():
        lines = log_path.read_text(encoding="utf-8", errors="ignore").splitlines()
        tail = " | ".join(lines[-5:])
    raise RuntimeError(f"app did not become ready: {last_problem}; log: {tail}")


# ---------------------------------------------------------------------------
# Headless Chrome capture
# ---------------------------------------------------------------------------


def capture_png(
    url: str,
    width: int,
    height: int,
    raw_path: Path,
    profile_dir: Path,
) -> None:
    """Ask Chrome to screenshot one URL at an exact window size."""
    command = [
        CHROME,
        "--headless=new",
        "--disable-gpu",
        "--hide-scrollbars",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-extensions",
        "--disable-background-networking",
        "--force-device-scale-factor=1",
        f"--user-data-dir={profile_dir}",
        "--virtual-time-budget=8000",
        f"--window-size={width},{height}",
        f"--screenshot={raw_path}",
        url,
    ]

    result = subprocess.run(
        command,
        cwd=ROOT,
        capture_output=True,
        text=True,
        timeout=CAPTURE_TIMEOUT,
        creationflags=hidden_flags(),
    )

    if not raw_path.is_file() or raw_path.stat().st_size == 0:
        detail = (result.stderr or result.stdout or "").strip()[-600:]
        raise RuntimeError(
            f"Chrome produced no screenshot for {url} "
            f"(exit {result.returncode}): {detail}"
        )


# ---------------------------------------------------------------------------
# JPEG normalisation
# ---------------------------------------------------------------------------


def encode_jpeg(source: Path, target: Path, size: tuple[int, int]) -> tuple[int, int]:
    """Crop to the target frame and shrink quality/scale until under 256 KiB."""
    with Image.open(source) as opened:
        image = opened.convert("RGB")

    # ImageOps.fit guarantees the requested frame, which is what keeps the
    # wide hero exactly 16:9 even if Chrome adds a pixel of chrome somewhere.
    image = ImageOps.fit(
        image,
        size,
        method=Image.Resampling.LANCZOS,
        centering=(0.5, 0.5),
    )

    # Never shrink the short edge below the required 480 px floor.
    min_scale = 480.0 / min(size)
    quality = 92
    scale = 1.0

    while True:
        if scale == 1.0:
            candidate = image
        else:
            new_size = (
                max(1, round(size[0] * scale)),
                max(1, round(size[1] * scale)),
            )
            candidate = image.resize(new_size, Image.Resampling.LANCZOS)

        buffer = io.BytesIO()
        candidate.save(
            buffer,
            format="JPEG",
            quality=quality,
            optimize=True,
            progressive=True,
        )
        payload = buffer.getvalue()

        if len(payload) <= MAX_BYTES:
            target.write_bytes(payload)
            return candidate.size

        if quality > 45:
            quality -= 6
            continue

        next_scale = max(min_scale, scale * 0.9)
        if next_scale >= scale:
            raise RuntimeError(f"cannot fit {target.name} under {MAX_BYTES} bytes")
        scale = next_scale


# ---------------------------------------------------------------------------
# Orchestration
# ---------------------------------------------------------------------------


def main() -> int:
    if not CHROME or not Path(CHROME).is_file():
        raise SystemExit(f"Chrome not found at {CHROME}")

    SHOT_DIR.mkdir(parents=True, exist_ok=True)

    with tempfile.TemporaryDirectory(prefix="leonida-shots-") as scratch:
        scratch_dir = Path(scratch)
        profile_dir = scratch_dir / "chrome-profile"
        profile_dir.mkdir()
        log_path = scratch_dir / "serve.log"

        server = start_server(log_path)
        captures: list[tuple[str, Path, tuple[int, int]]] = []

        try:
            wait_for_app(server, log_path)

            for index, (name, query, width, height, final_w, final_h) in enumerate(VIEWS):
                raw_path = scratch_dir / f"raw-{index}.png"
                url = f"{BASE_URL}?{query}"
                print(f"[capture] {name} <- {url} at {width}x{height}")
                capture_png(url, width, height, raw_path, profile_dir)
                captures.append((name, raw_path, (final_w, final_h)))

            for name, raw_path, final_size in captures:
                dimensions = encode_jpeg(raw_path, SHOT_DIR / name, final_size)
                real_bytes = (SHOT_DIR / name).stat().st_size
                print(
                    f"[jpeg] {name}: {dimensions[0]}x{dimensions[1]} "
                    f"· {real_bytes} bytes"
                )
        finally:
            stop_server(server)

    print(f"[done] four screenshots written to {SHOT_DIR}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
