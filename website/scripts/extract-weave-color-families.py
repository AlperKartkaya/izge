#!/usr/bin/env python3
"""Extract semantic color-family overlays from the Izge hero weave artwork.

The interaction assets are derived from pixels already present in
hero-memory-weave.png. The extraction uses a hybrid model:

1. broad family gates from HSV/chroma/luminance logic, and
2. image-specific anchor swatches that refine confidence inside each gate.

It does not draw new nodes, lines, or shapes. Netpbm's pngtopnm/pnmtopng are
used so the script stays dependency-light for the static website.
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

# Anchor swatches are intentionally plural and soft. They refine broad family
# detection against the actual artwork without requiring exact swatch matches.
ANCHORS: dict[str, tuple[tuple[int, int, int], ...]] = {
    "stable": (
        # User-picked dark blue / blue-green tones from the source artwork.
        # These are deliberately dark, so the stable family uses a low-light
        # gate instead of the brighter gates used for contradiction/next.
        (16, 25, 27),
        (10, 34, 49),
        (52, 69, 75),
        (8, 22, 25),
        (25, 42, 48),
        (9, 20, 26),
        (9, 16, 19),
        (56, 101, 98),
        (36, 47, 52),
        (11, 14, 15),
        (19, 27, 31),
        (27, 39, 44),
        (22, 37, 42),
        (26, 38, 39),
        (17, 25, 26),
        (22, 25, 23),
        (17, 30, 34),
        (25, 29, 42),
    ),
    "contradiction": (
        (75, 1, 8),
        (96, 10, 14),
        (128, 24, 22),
        (164, 42, 31),
    ),
    "drift": (
        (82, 57, 42),
        (104, 69, 42),
        (128, 84, 48),
        (151, 106, 66),
    ),
    "next": (
        (201, 180, 149),
        (218, 188, 137),
        (184, 152, 109),
        (242, 215, 178),
    ),
}

# Per-family blending reflects the artwork: contradiction needs stronger anchor
# precision to avoid brown bleed; stable needs a broader gate because the dark
# structural color is low-light; next remains luminance constrained.
BLEND = {
    "stable": {"broad": 0.50, "anchor": 0.50, "sigma": 42.0, "floor": 0.22},
    "contradiction": {"broad": 0.44, "anchor": 0.56, "sigma": 54.0, "floor": 0.12},
    "drift": {"broad": 0.54, "anchor": 0.46, "sigma": 58.0, "floor": 0.14},
    "next": {"broad": 0.58, "anchor": 0.42, "sigma": 70.0, "floor": 0.10},
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


def anchor_score(family: str, rgb: tuple[int, int, int]) -> float:
    sigma = BLEND[family]["sigma"]
    scores = [rgb_distance_score(rgb, anchor, sigma) for anchor in ANCHORS[family]]
    # Max keeps distinct thread colors alive; average rewards clusters close to
    # multiple anchors. The mix avoids both overfitting and noisy over-inclusion.
    return clamp(max(scores) * 0.72 + (sum(scores) / len(scores)) * 0.28)


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


def broad_family_scores(r: int, g: int, b: int) -> dict[str, float]:
    rn, gn, bn = r / 255.0, g / 255.0, b / 255.0
    hue, sat, value = colorsys.rgb_to_hsv(rn, gn, bn)
    hue *= 360.0
    chroma = (max(r, g, b) - min(r, g, b)) / 255.0
    luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255.0

    # Common gates prevent black background and neutral shadows from being
    # treated as semantic color. Soft gates keep thread edges feathered.
    visible_color = smoothstep(0.035, 0.13, chroma) * smoothstep(0.035, 0.14, value)
    saturated = smoothstep(0.10, 0.34, sat)

    stable_hue = max(hue_gaussian(hue, 178.0, 46.0), hue_gaussian(hue, 205.0, 42.0), hue_gaussian(hue, 224.0, 34.0))
    stable_low_light = smoothstep(0.025, 0.105, value) * (1.0 - smoothstep(0.50, 0.78, value))
    stable_color_presence = max(
        smoothstep(0.045, 0.20, sat),
        smoothstep(0.028, 0.105, chroma),
    )
    stable = stable_hue * stable_color_presence * stable_low_light

    contradiction = (
        max(hue_gaussian(hue, 356.0, 24.0), hue_gaussian(hue, 6.0, 22.0))
        * saturated
        * smoothstep(0.055, 0.18, value)
        * (1.0 - smoothstep(0.28, 0.50, hue_distance(hue, 32.0) / 180.0))
        * visible_color
    )

    drift = (
        hue_gaussian(hue, 30.0, 25.0)
        * smoothstep(0.08, 0.30, sat)
        * smoothstep(0.055, 0.18, value)
        * (1.0 - smoothstep(0.58, 0.88, value))
        * visible_color
    )

    next_action = (
        hue_gaussian(hue, 41.0, 24.0)
        * smoothstep(0.035, 0.18, sat)
        * smoothstep(0.36, 0.72, value)
        * smoothstep(0.34, 0.62, luminance)
    )

    return {
        "stable": stable,
        "contradiction": contradiction,
        "drift": drift,
        "next": next_action,
    }


def family_scores(r: int, g: int, b: int) -> dict[str, float]:
    rgb = (r, g, b)
    broad = broad_family_scores(r, g, b)
    scores: dict[str, float] = {}
    for family in FAMILIES:
        broad_score = broad[family]
        anchor = anchor_score(family, rgb)
        if family == "stable":
            # Stable-memory pixels are extremely dark in the artwork. Keep the
            # broad family gate, but let a strong source-image anchor lift
            # plausible low-light blue/green structure above the noise floor.
            gate = max(smoothstep(0.020, 0.22, broad_score), smoothstep(0.30, 0.72, anchor) * smoothstep(0.012, 0.09, max(rgb) / 255.0))
        else:
            gate = smoothstep(0.035, 0.34, broad_score)
        blend = BLEND[family]
        hybrid = blend["broad"] * broad_score + blend["anchor"] * anchor
        # The broad floor preserves soft thread edges only after the broad gate
        # has said the pixel plausibly belongs to the family.
        floor = blend["floor"] * broad_score
        scores[family] = clamp(gate * max(hybrid, floor))
    return scores


def alpha_for(family: str, scores: dict[str, float]) -> int:
    ordered = sorted(scores.values(), reverse=True)
    best = scores[family]
    if best < 0.07 or best < ordered[0] - 1e-9:
        return 0
    second = ordered[1] if len(ordered) > 1 else 0.0
    confidence = clamp(0.30 + (best - second) / 0.26)
    alpha = smoothstep(0.07, 0.68, best) * confidence
    # Keep overlays embedded rather than posterized: no family can become a
    # fully opaque repaint of the artwork.
    return round(212 * clamp(alpha))


def clean_alpha(width: int, height: int, alpha: bytearray) -> bytearray:
    cleaned = bytearray(alpha)
    for y in range(height):
        row = y * width
        for x in range(width):
            idx = row + x
            a = alpha[idx]
            if a == 0:
                continue

            neighbor_values: list[int] = []
            for yy in range(max(0, y - 1), min(height, y + 2)):
                for xx in range(max(0, x - 1), min(width, x + 2)):
                    nidx = yy * width + xx
                    if nidx == idx:
                        continue
                    if alpha[nidx] > 16:
                        neighbor_values.append(alpha[nidx])

            count = len(neighbor_values)
            if count == 0:
                cleaned[idx] = round(a * 0.18)
            elif count == 1 and a < 92:
                cleaned[idx] = 0
            elif count <= 2 and a < 42:
                cleaned[idx] = 0
            elif count >= 2:
                neighbor_avg = sum(neighbor_values) / count
                cleaned[idx] = round(clamp((a * 0.88 + neighbor_avg * 0.12) / 255.0) * 255)

    return cleaned


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

            overlay_alpha = clean_alpha(width, height, overlay_alpha)
            for i, alpha in enumerate(overlay_alpha):
                if alpha == 0:
                    offset = i * 3
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
