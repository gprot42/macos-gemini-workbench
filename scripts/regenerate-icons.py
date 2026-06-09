#!/usr/bin/env python3
"""Regenerate Tauri icon PNGs and icon.icns from icons/1024x1024.png."""
import os
import shutil
import subprocess
import sys

from PIL import Image

ROOT = os.path.join(os.path.dirname(__file__), "..", "src-tauri")
ICON_DIR = os.path.join(ROOT, "icons")
SOURCE = os.path.join(ICON_DIR, "1024x1024.png")


def main() -> int:
    if not os.path.isfile(SOURCE):
        print(f"ERROR: Missing source icon at {SOURCE}", file=sys.stderr)
        return 1

    src = Image.open(SOURCE).convert("RGBA")
    sizes = [16, 32, 64, 128, 256, 512, 1024]
    for size in sizes:
        out = os.path.join(ICON_DIR, f"{size}x{size}.png")
        src.resize((size, size), Image.LANCZOS).save(out)

    src.save(os.path.join(ICON_DIR, "icon.png"))

    iconset = os.path.join(ICON_DIR, "icon.iconset")
    shutil.rmtree(iconset, ignore_errors=True)
    os.makedirs(iconset, exist_ok=True)
    for size in [16, 32, 64, 128, 256, 512]:
        shutil.copy(
            os.path.join(ICON_DIR, f"{size}x{size}.png"),
            os.path.join(iconset, f"icon_{size}x{size}.png"),
        )
        shutil.copy(
            os.path.join(ICON_DIR, f"{size * 2}x{size * 2}.png"),
            os.path.join(iconset, f"icon_{size}x{size}@2x.png"),
        )

    icns_path = os.path.join(ICON_DIR, "icon.icns")
    result = subprocess.run(
        ["iconutil", "-c", "icns", iconset, "-o", icns_path],
        capture_output=True,
        text=True,
    )
    shutil.rmtree(iconset, ignore_errors=True)
    if result.returncode != 0:
        print(result.stderr or result.stdout, file=sys.stderr)
        return result.returncode

    print(f"Regenerated icons in {ICON_DIR}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())