#!/usr/bin/env python3
"""Extract semantic color-family overlays from the Izge hero weave artwork.

This script intentionally derives interaction overlays from the pixels already
present in hero-memory-weave.png. It does not draw new nodes, lines, or shapes.
It requires Netpbm's pngtopnm/pnmtopng utilities, which are available in the
local development environment.
"""
from __future__ import annotations

import colorsys
import math
import shutil
import subprocess
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "assets" / "hero-memory-weave.png"
OUT_DIR = ROOT / "assets"

FAMILIES = {
    "stable": "dark structural green-blue memory",
    "contradiction": "burgundy red contradiction tension",
    "drift": "brown woven-depth assumption drift",
    "next": "pale amber next-action guidance",
}


def clamp(value: float, low: float = 0.0, high: float = 1.0) -> float:
    return max(low, min(high, value))


def smoothstep(edge0: float, edge1: float, value: float) -> float:
    if edge0 == edge1:
        return 1.0 if value >= edge1 else 0.0
    t = clamp((value - edge0) / (edge1 - edge0))
    return t * t * (3.0 - 2.0 * t)


def hue_distance(a: float, b: float) -> float:
    d = abs(a - b) % 360.0
    return min(d, 360.0 - d)


def hue_gaussian(hue: float, target: float, sigma: float) -> float:
    d = hue_distance(hue, target)
    return math.exp(-(d * d) / (2.0 * sigma * sigma))


def rgb_distance_score(rgb: tuple[int, int, int], target: tuple[int, int, int], sigma: float) -> float:
    d = math.sqrt(sum((a - b) ** 2 for a, b in zip(rgb, target)))
    return math.exp(-(d * d) / (2.0 * sigma * sigma))


def read_ppm(path: Path) -> tuple[int, int, int, bytes]:
    data = path.read_bytes()
    index = 0

    def token() -> bytes:
        nonlocal index
        while index < len(data) and data[index] in b" \t\r\n":
            index += 1
        if index < len(data) and data[index] == ord("#"):
            while index < len(data) and data[index] not in b"\r\n":
                index += 1
            return token()
        start = index
        while index < len(data) and data[index] not in b" \t\r\n":
            index += 1
        return data[start:index]

    magic = token()
    if magic != b"P6":
        raise ValueError(f"expected P6 PPM, got {magic!r}")
    width = int(token())
    height = int(token())
    maxval = int(token())
    while index < len(data) and data[index] in b" \t\r\n":
        index += 1
    pixels = data[index:]
    expected = width * height * 3
    if len(pixels) != expected:
        raise ValueError(f"expected {expected} bytes, got {len(pixels)}")
    return width, height, maxval, pixels


def write_ppm(path: Path, width: int, height: int, pixels: bytearray) -> None:
    path.write_bytes(f"P6\n{width} {height}\n255\n".encode() + bytes(pixels))


def write_pgm(path: Path, width: int, height: int, alpha: bytearray) -> None:
    path.write_bytes(f"P5\n{width} {height}\n255\n".encode() + bytes(alpha))


def family_scores(r: int, g: int, b: int) -> dict[str, float]:
    rn, gn, bn = r / 255.0, g / 255.0, b / 255.0
    hue, sat, value = colorsys.rgb_to_hsv(rn, gn, bn)
    hue *= 360.0
    chroma = (max(r, g, b) - min(r, g, b)) / 255.0
    luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255.0

    # Common gates prevent black background and neutral shadows from being
    # treated as semantic color. Soft gates keep thread edges feathered.
    visible_color = smoothstep(0.035, 0.13, chroma) * smoothstep(0.035, 0.14, value)
    saturated = smoothstep(0.10, 0.34, sat)

    stable = (
        max(hue_gaussian(hue, 178.0, 42.0), hue_gaussian(hue, 205.0, 36.0))
        * smoothstep(0.08, 0.28, sat)
        * smoothstep(0.05, 0.18, value)
        * (1.0 - smoothstep(0.62, 0.9, value))
        * visible_color
    )

    contradiction = (
        max(hue_gaussian(hue, 356.0, 24.0), hue_gaussian(hue, 6.0, 22.0))
        * saturated
        * smoothstep(0.055, 0.18, value)
        * (1.0 - smoothstep(0.28, 0.50, hue_distance(hue, 32.0) / 180.0))
        * visible_color
    )
    # Deep burgundy can be very dark; reinforce target-near pixels without
    # spilling into neutral blacks.
    contradiction = max(
        contradiction,
        rgb_distance_score((r, g, b), (75, 1, 8), 62.0) * smoothstep(0.06, 0.19, sat) * smoothstep(0.04, 0.16, value),
    )

    drift = (
        hue_gaussian(hue, 30.0, 25.0)
        * smoothstep(0.08, 0.30, sat)
        * smoothstep(0.055, 0.18, value)
        * (1.0 - smoothstep(0.58, 0.88, value))
        * visible_color
    )
    drift = max(
        drift,
        rgb_distance_score((r, g, b), (82, 57, 42), 70.0) * smoothstep(0.05, 0.18, chroma) * smoothstep(0.05, 0.16, value),
    )

    next_action = (
        hue_gaussian(hue, 41.0, 24.0)
        * smoothstep(0.035, 0.18, sat)
        * smoothstep(0.36, 0.72, value)
        * smoothstep(0.34, 0.62, luminance)
    )
    next_action = max(
        next_action,
        rgb_distance_score((r, g, b), (201, 180, 149), 92.0) * smoothstep(0.38, 0.68, luminance),
    )

    return {
        "stable": stable,
        "contradiction": contradiction,
        "drift": drift,
        "next": next_action,
    }


def alpha_for(family: str, scores: dict[str, float]) -> int:
    ordered = sorted(scores.values(), reverse=True)
    best = scores[family]
    if best < 0.08 or best < ordered[0] - 1e-9:
        return 0
    second = ordered[1] if len(ordered) > 1 else 0.0
    confidence = clamp(0.34 + (best - second) / 0.30)
    alpha = smoothstep(0.08, 0.74, best) * confidence
    # Keep overlays embedded rather than posterized: no family can become a
    # fully opaque repaint of the artwork.
    return round(220 * clamp(alpha))


def main() -> None:
    if not SOURCE.exists():
        raise SystemExit(f"missing source image: {SOURCE}")
    for command in ("pngtopnm", "pnmtopng"):
        if not shutil.which(command):
            raise SystemExit(f"missing required command: {command}")

    with tempfile.TemporaryDirectory() as temp_dir:
        temp = Path(temp_dir)
        source_ppm = temp / "source.ppm"
        with source_ppm.open("wb") as handle:
            subprocess.run(["pngtopnm", str(SOURCE)], check=True, stdout=handle)

        width, height, maxval, pixels = read_ppm(source_ppm)
        if maxval != 255:
            raise ValueError(f"unsupported maxval {maxval}; expected 255")

        for family in FAMILIES:
            overlay_rgb = bytearray(pixels)
            overlay_alpha = bytearray(width * height)
            for i in range(width * height):
                offset = i * 3
                r, g, b = pixels[offset], pixels[offset + 1], pixels[offset + 2]
                alpha = alpha_for(family, family_scores(r, g, b))
                overlay_alpha[i] = alpha
                if alpha == 0:
                    overlay_rgb[offset] = 0
                    overlay_rgb[offset + 1] = 0
                    overlay_rgb[offset + 2] = 0

            ppm = temp / f"{family}.ppm"
            pgm = temp / f"{family}.pgm"
            out = OUT_DIR / f"hero-memory-weave-family-{family}.png"
            write_ppm(ppm, width, height, overlay_rgb)
            write_pgm(pgm, width, height, overlay_alpha)
            with out.open("wb") as handle:
                subprocess.run(["pnmtopng", "-compression=9", f"-alpha={pgm}", str(ppm)], check=True, stdout=handle)
            print(f"wrote {out.relative_to(ROOT)} — {FAMILIES[family]}")


if __name__ == "__main__":
    main()
