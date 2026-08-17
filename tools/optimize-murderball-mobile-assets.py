"""Build lossless, render-sized WebP assets for Murderball mobile clients.

Original PNG masters are never modified. Map objects are retained at 1.5 times
their largest in-game draw size; shared UI/game sprites retain up to 384 pixels
on their longest edge. Both profiles exceed the renderer's mobile pixel demand
while sharply reducing download and decoded texture memory.
"""

from __future__ import annotations

import json
import math
import re
from pathlib import Path

from PIL import Image


REPOSITORY = Path(__file__).resolve().parents[1]
GAME_ROOT = REPOSITORY / "games" / "game-03"
PLACEMENT_RE = re.compile(r'assetId:\s*"([^"]+)".*?width:\s*([\d.]+),\s*height:\s*([\d.]+)')
HELPER_RE = re.compile(r'(?:lava|terrain)\("[^"]+",\s*"([^"]+)"\s*,.*?,\s*.*?,\s*([\d.]+),\s*([\d.]+)')


def placement_sizes() -> dict[str, tuple[float, float]]:
    sizes: dict[str, tuple[float, float]] = {}
    for map_source in (GAME_ROOT / "maps").glob("*/map.js"):
        source = map_source.read_text(encoding="utf-8")
        for pattern in (PLACEMENT_RE, HELPER_RE):
            for asset_id, width_text, height_text in pattern.findall(source):
                width, height = float(width_text), float(height_text)
                previous = sizes.get(asset_id, (0.0, 0.0))
                sizes[asset_id] = max(previous[0], width), max(previous[1], height)
    return sizes


def definition_ids() -> dict[Path, str]:
    ids: dict[Path, str] = {}
    for definition_path in (GAME_ROOT / "maps").rglob("*.json"):
        try:
            definition = json.loads(definition_path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, UnicodeDecodeError):
            continue
        sprite = definition.get("sprite")
        asset_id = definition.get("id")
        if isinstance(sprite, str) and isinstance(asset_id, str):
            ids[(definition_path.parent / sprite).resolve()] = asset_id
    return ids


def fitted_size(source_size: tuple[int, int], max_edge: int) -> tuple[int, int]:
    width, height = source_size
    scale = min(1.0, max_edge / max(width, height))
    return max(1, round(width * scale)), max(1, round(height * scale))


def target_size(source: Path, source_size: tuple[int, int], sizes: dict[str, tuple[float, float]], ids: dict[Path, str]) -> tuple[int, int]:
    relative = source.relative_to(GAME_ROOT).as_posix()
    if relative.startswith("maps/"):
        # Terrain and boundary strips define their own sampling scale and keep
        # every source pixel. Placed objects need only exceed their final canvas
        # size; 1.5x leaves ample interpolation headroom on the DPR-1 renderer.
        if "/terrain/" in relative or "/boundary/" in relative:
            return source_size
        asset_id = ids.get(source.resolve())
        if asset_id in sizes:
            desired = tuple(max(1, math.ceil(value * 1.5)) for value in sizes[asset_id])
            if desired[0] <= source_size[0] and desired[1] <= source_size[1]:
                return desired
        return fitted_size(source_size, 540)
    return fitted_size(source_size, 384)


def main() -> None:
    sizes = placement_sizes()
    ids = definition_ids()
    sources = sorted(GAME_ROOT.rglob("*.png"))
    written: list[Path] = []
    decoded_bytes = 0
    for source in sources:
        target = source.with_name(f"{source.stem}.mobile.webp")
        with Image.open(source) as image:
            size = target_size(source, image.size, sizes, ids)
            optimized = image if size == image.size else image.resize(size, Image.Resampling.LANCZOS)
            optimized.save(target, "WEBP", lossless=True, quality=100, method=6, exact=False)
            decoded_bytes += optimized.width * optimized.height * 4
        written.append(target)

    total_bytes = sum(path.stat().st_size for path in written)
    preview_jobs = (
        (GAME_ROOT / "maps/lunar-liability/terrain/dusty-orbit-ground-runtime.webp", GAME_ROOT / "maps/lunar-liability/preview/dusty-orbit-lobby-preview.webp", (960, 600)),
        (GAME_ROOT / "maps/hell-moon/preview/hell-moon-lobby-preview.webp", GAME_ROOT / "maps/hell-moon/preview/hell-moon-lobby-preview-optimized.webp", (960, 360)),
    )
    for source, target, size in preview_jobs:
        target.parent.mkdir(parents=True, exist_ok=True)
        with Image.open(source) as image:
            preview = image.resize(size, Image.Resampling.LANCZOS)
            preview.save(target, "WEBP", lossless=True, quality=100, method=6, exact=False)
    print(f"assets={len(written)} download_mb={total_bytes / 1024 / 1024:.2f} decoded_mb={decoded_bytes / 1024 / 1024:.2f} previews={len(preview_jobs)}")


if __name__ == "__main__":
    main()
