import test from 'node:test';
import assert from 'node:assert/strict';
import { finaleState } from '../finale-motion.js';
import { buildHeroTimeline, scrollPlaybackTime, scrollStreamRate } from '../hero-motion.js';

test('finale holds the team scene, sends on scroll, then hands over to closing', () => {
  assert.deepEqual(finaleState(-1), { conversation: 0, send: 0, closing: 0 });
  assert.equal(finaleState(.02).send > 0, true);
  assert.equal(finaleState(.1).send, 1);
  assert.equal(finaleState(.75).closing, 0);
  assert.equal(finaleState(.88).closing, .5);
  assert.deepEqual(finaleState(2), { conversation: 1, send: 1, closing: 1 });
});

test('stream is 50 percent faster, scroll velocity boosts it with a bounded rate', () => {
  const timeline = buildHeroTimeline('tr');
  const stream = timeline.events.find(event => event.type === 'stream');
  assert.equal(stream.duration, 7000 / 1.5);
  assert.equal(scrollStreamRate(0), 1);
  assert.equal(scrollStreamRate(1), 1.75);
  assert.equal(scrollStreamRate(-1), 1.75);
  assert.equal(scrollStreamRate(100), 4);
});

test('team reactions wait for further scroll after the complete streamed answer', () => {
  const timeline = buildHeroTimeline();
  const stream = timeline.events.find(event => event.type === 'stream');
  const reaction = timeline.events.find(event => event.id === 'reaction');
  assert.equal(scrollPlaybackTime(.3, timeline).ceiling, stream.at + stream.duration);
  assert.equal(scrollPlaybackTime(.5, timeline).floor > stream.at, true);
  assert.deepEqual(scrollPlaybackTime(.63, timeline), { floor: reaction.at, ceiling: reaction.at });
  assert.deepEqual(scrollPlaybackTime(.83, timeline), { floor: timeline.duration, ceiling: timeline.duration });
});

test('reverse scroll maps back through colleagues, stream, thinking and the sent message', async () => {
  const { scrollRewindTime } = await import('../hero-motion.js');
  const timeline = buildHeroTimeline('tr');
  const positions = [.9, .7, .6, .5, .4, .2, .12, 0];
  const times = positions.map(p => scrollRewindTime(p, timeline));
  assert.deepEqual(times, [...times].sort((a,b) => b-a));
  assert.equal(times.at(-1), 0);
  assert.equal(scrollRewindTime(.42, timeline), 5200);
  const question = timeline.events[0].message;
  assert.equal(question.name, 'Siz');
  assert.equal(question.role, 'self');
  assert.equal(question.body, '@izge Teslim kaydıyla faturayı karşılaştır');
});
