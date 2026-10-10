#!/usr/bin/env python3
"""Crop the documented 3×3 sheets with the locally installed ImageMagick."""
import json
from pathlib import Path
import re
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / 'docs/design/icons/manifest.json'
OUT = ROOT / 'frontend/src/assets/button-icons'


def run(*args):
    return subprocess.check_output(['magick', *map(str, args)], text=True).strip()


def main():
    assert shutil.which('magick'), 'ImageMagick must be available for asset preparation; the app does not require it.'
    manifest = json.loads(MANIFEST.read_text())
    OUT.mkdir(parents=True, exist_ok=True)
    prepared = []
    with tempfile.TemporaryDirectory() as tmp:
        for sheet in manifest['sheets']:
            source = MANIFEST.parent / 'incoming' / sheet['file']
            width, height, channels, minimum, maximum = run('identify', '-format', '%w,%h,%[channels],%[fx:minima.a],%[fx:maxima.a]', source).split(',')
            assert width == height and int(width) % 3 == 0, f'{source}: must have an even 3×3 grid'
            assert 'a' in channels and float(minimum) == 0 and float(maximum) > 0, f'{source}: real transparent glyphs required'
            normalized = Path(tmp) / sheet['file']
            run(source, '-resize', f"{manifest['sheet_size']}x{manifest['sheet_size']}!", normalized)
            for icon in sheet['icons']:
                left, top, right, bottom = icon['crop']
                target = OUT / f"{icon['id']}.png"
                run(normalized, '-crop', f'{right-left}x{bottom-top}+{left}+{top}', '+repage',
                    '-channel', 'A', '-fuzz', '1%', '-trim', '+channel', '+repage',
                    '-resize', '232x232', '-background', 'none', '-gravity', 'center', '-extent', '256x256',
                    '-channel', 'RGB', '-evaluate', 'set', '100%', '+channel', target)
                w, h, minimum, maximum, bounds = run('identify', '-format', '%w %h %[fx:minima.a] %[fx:maxima.a] %@', target).split()
                assert (w, h) == ('256', '256') and float(minimum) == 0 and float(maximum) > 0, target
                glyph_w, glyph_h, x, y = map(int, re.fullmatch(r'(\d+)x(\d+)\+(\d+)\+(\d+)', bounds).groups())
                assert abs(x + glyph_w / 2 - 128) <= 2 and abs(y + glyph_h / 2 - 128) <= 2, f'{target}: glyph is not centered'
                prepared.append(icon['id'])
    assert len(prepared) == len(set(prepared)) == 36
    print(json.dumps({'prepared': len(prepared), 'output': str(OUT)}, ensure_ascii=False))


if __name__ == '__main__':
    main()
