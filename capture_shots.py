#!/usr/bin/env python3
"""Regenerate review renders for Leonida Key Art Lab into a disposable scratch folder.

The four images in screenshots/ are the accepted set and are never overwritten here.
By default the renders land in .shot-preview/ next to this file; pass --output-dir to
put them somewhere else inside the checkout. A run needs Node.js 22 and Pillow.
"""

from __future__ import annotations

import argparse
import subprocess
import tempfile
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path

try:
    from PIL import Image
except ImportError as exc:  # Pillow is only needed for the final measurement step.
    raise SystemExit("Pillow is missing; install it with `python -m pip install Pillow`") from exc


# --- Fixed facts about this entry -------------------------------------------------

ROOT = Path(__file__).resolve().parent
CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
PORT = 8098
BASE_URL = f"http://127.0.0.1:{PORT}/"

# A 200 from the server only proves that bytes came back. The page must also identify
# itself before a render is worth keeping, so both strings below have to be present.
MARKER = "Leonida Key Art Lab"
SECONDARY_MARKER = 'id="preview"'

MAX_BYTES = 262144
MAX_LONG_SIDE = 1280
MIN_SHORT_SIDE = 480

DEFAULT_OUTPUT = ROOT / ".shot-preview"
FINAL_FOLDER = ROOT / "screenshots"


@dataclass(frozen=True)
class View:
    """One URL/window pair that produces a single review image."""

    name: str
    query: str
    width: int
    height: int


# Window sizes are viewports, not the final PNG dimensions; the real numbers are
# read back from each encoded file below rather than assumed from these values.
VIEWS = (
    View(
        "1-cover-portrait.png",
        "shot=cover&size=portrait&grade=sunset&caption=COPPER%20HALO",
        1024,
        1280,
    ),
    View(
        "2-cover-wide.png",
        "shot=cover&size=wide&grade=rain&caption=COPPER%20HALO",
        1280,
        720,
    ),
    View(
        "3-cover-square.png",
        "shot=cover&size=square&grade=ink&caption=COPPER%20HALO",
        1080,
        1080,
    ),
    View("4-editor.png", "shot=editor", 1280, 800),
)


def hidden_flags() -> int:
    """Windows flags that keep both servers and browsers off the visible desktop."""
    flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    flags |= getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)
    return flags


def start_server() -> subprocess.Popen:
    """Launch the static file server in the background with no console window."""
    entry = ROOT / "serve.ts"
    if not entry.is_file():
        raise SystemExit(f"serve.ts is missing from {ROOT}")
    return subprocess.Popen(
        ["node", "serve.ts", "--port", str(PORT)],
        cwd=ROOT,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        creationflags=hidden_flags(),
    )


def stop_server(server: subprocess.Popen) -> None:
    """Reap the server even if a capture fails; no child is left behind."""
    if server.poll() is not None:
        return
    server.terminate()
    try:
        server.wait(timeout=5)
    except subprocess.TimeoutExpired:
        server.kill()
        server.wait(timeout=5)


def wait_for_app(timeout: float = 30.0) -> None:
    """Poll until the served HTML contains the editor's own identifying strings."""
    deadline = time.monotonic() + timeout
    last_problem = "no attempt made yet"
    while time.monotonic() < deadline:
        try:
            with urllib.request.urlopen(BASE_URL, timeout=3) as response:
                if response.status != 200:
                    last_problem = f"HTTP status {response.status}"
                else:
                    page = response.read().decode("utf-8", "replace")
                    if MARKER in page and SECONDARY_MARKER in page:
                        print(
                            "page identity confirmed: both "
                            f"'{MARKER}' and '{SECONDARY_MARKER}' found in the served HTML"
                        )
                        return
                    last_problem = "status 200, but the app marker text was absent"
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            last_problem = str(exc)
        time.sleep(0.25)
    raise SystemExit(f"could not identify the app at {BASE_URL}: {last_problem}")


def capture(view: View, target: Path, profile: Path) -> None:
    """Ask Chrome to paint one URL into one PNG file."""
    url = BASE_URL + "?" + view.query
    command = [
        CHROME,
        "--headless=new",
        "--disable-gpu",
        "--hide-scrollbars",
        "--virtual-time-budget=8000",
        f"--window-size={view.width},{view.height}",
        f"--screenshot={target}",
        f"--user-data-dir={profile}",
        url,
    ]
    try:
        finished = subprocess.run(
            command,
            cwd=ROOT,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            creationflags=hidden_flags(),
            timeout=90,
        )
    except subprocess.TimeoutExpired as exc:
        raise SystemExit(f"Chrome timed out while rendering {view.name}") from exc
    if finished.returncode != 0:
        detail = finished.stderr.decode("utf-8", "replace").strip()[-1200:]
        raise SystemExit(f"Chrome exited {finished.returncode} for {view.name}: {detail}")
    if not target.is_file():
        raise SystemExit(f"Chrome reported success but wrote no file at {target}")


def verify(path: Path) -> None:
    """Measure the encoded PNG and report the actual byte and pixel counts."""
    size = path.stat().st_size
    with Image.open(path) as image:
        width, height = image.size
        image.verify()
    long_side = max(width, height)
    short_side = min(width, height)
    print(
        f"{path.name}: {size} bytes, {width}x{height} px "
        f"(long side {long_side}, short side {short_side})"
    )
    if size >= MAX_BYTES:
        raise SystemExit(f"{path.name} is {size} bytes; the ceiling is {MAX_BYTES - 1}")
    if long_side > MAX_LONG_SIDE:
        raise SystemExit(f"{path.name} has long side {long_side}; limit is {MAX_LONG_SIDE}")
    if short_side < MIN_SHORT_SIDE:
        raise SystemExit(f"{path.name} has short side {short_side}; floor is {MIN_SHORT_SIDE}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=DEFAULT_OUTPUT,
        help=f"scratch folder for the renders (default: {DEFAULT_OUTPUT})",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    output = args.output_dir.resolve()

    # Guard the accepted screenshots even if someone aims this script at them.
    if output == FINAL_FOLDER.resolve() or FINAL_FOLDER.resolve() in output.parents:
        raise SystemExit("refusing to write inside the final screenshots/ folder")

    if not Path(CHROME).is_file():
        raise SystemExit(f"Chrome was not found at {CHROME}")

    output.mkdir(parents=True, exist_ok=True)
    server = start_server()
    try:
        wait_for_app()
        with tempfile.TemporaryDirectory(
            dir=output, prefix="chrome-profile-"
        ) as profile_dir:
            for view in VIEWS:
                print(f"rendering {view.name} from {BASE_URL}?{view.query}")
                destination = output / view.name
                capture(view, destination, Path(profile_dir))
                verify(destination)
    finally:
        stop_server(server)

    print(f"all four renders passed; scratch files are in {output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
