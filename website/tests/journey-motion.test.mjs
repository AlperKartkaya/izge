import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { introStep, openingReplyState, INTRO_DURATION } from '../journey-motion.js';
import { chapterState } from '../scroll-motion.js';

test('opening fades the mark in place before revealing it inside the graph', () => {
  assert.deepEqual([0, 899, 900, 1099, 1100, 1399, 1400, 2649, 2650, 3450, 7450, INTRO_DURATION].map(introStep), [0, 0, 1, 1, 2, 2, 3, 3, 4, 5, 6, 6]);
  assert.equal(INTRO_DURATION, 12000);
});
test('opening reply thinks for two seconds, streams for two, then stays complete', async () => {
  assert.deepEqual(openingReplyState(3449), { thinking: false, progress: 0 });
  assert.deepEqual(openingReplyState(3450), { thinking: true, progress: 0 });
  assert.deepEqual(openingReplyState(5449), { thinking: true, progress: 0 });
  assert.deepEqual(openingReplyState(5450), { thinking: false, progress: 0 });
  assert.deepEqual(openingReplyState(6450), { thinking: false, progress: .5 });
  assert.deepEqual(openingReplyState(7450), { thinking: false, progress: 1 });
  assert.deepEqual(openingReplyState(INTRO_DURATION), { thinking: false, progress: 1 });

  const code = await readFile(new URL('../journey-motion.js', import.meta.url), 'utf8');
  assert.doesNotMatch(code, /intro-(?:toggle|skip|replay)/);
});
test('scroll chapters clamp boundaries and reveal detail after construction', () => {
  assert.deepEqual([0, .25, .5, .75, 1].map(p => chapterState(p).index), [0, 1, 2, 3, 3]);
  assert.equal(chapterState(-2).index, 0);
  assert.equal(chapterState(Number.NaN).index, 0);
  assert.equal(chapterState(3).detail, 1);
  assert.equal(chapterState(.01).detail, 0);
  assert.equal(chapterState(.2).build, 1);
  assert.equal(chapterState(.2).detail, 1);
});
test('website preserves local-only examples and source disclosure in both languages', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /data-en="Not another tool\." data-tr=""/);
  assert.doesNotMatch(html, /Bir araç daha değil/);
  assert.match(html, /Prepared, not sent/);
  assert.match(html, /Hazırlandı, gönderilmedi/);
  assert.match(html, /Customer confirmation and commercial approval required/);
  for (const id of ['contract', 'delivery', 'invoice']) assert.match(html, new RegExp(`data-source="${id}"`));
  for (const file of ['story.js', 'journey-motion.js', 'scroll-motion.js']) {
    const code = await readFile(new URL(`../${file}`, import.meta.url), 'utf8');
    assert.doesNotMatch(code, /\bfetch\s*\(|XMLHttpRequest|WebSocket/);
  }
});
