import assert from 'node:assert/strict';
import test from 'node:test';

import { evidenceStage, pinnedProgress, viewportProgress, workItemReveal } from '../scroll-motion.js';

test('viewportProgress maps a section entering and leaving the viewport', () => {
  assert.equal(viewportProgress(780, 1000, 1000), 0);
  assert.equal(viewportProgress(-780, 1000, 1000), 1);
  assert.equal(viewportProgress(0, 1000, 1000), 0.5);
  assert.equal(viewportProgress(Number.NaN, 1000, 1000), 0);
});

test('pinnedProgress uses only the distance where the evidence panel is pinned', () => {
  assert.equal(pinnedProgress(76, 1500, 500), 0);
  assert.equal(pinnedProgress(-424, 1500, 500), 0.5);
  assert.equal(pinnedProgress(-924, 1500, 500), 1);
  assert.equal(pinnedProgress(0, 500, 500), 0);
});

test('evidenceStage advances contract, delivery, invoice, then review', () => {
  assert.deepEqual([0, 0.3, 0.58, 0.82, 1].map(evidenceStage), [0, 1, 2, 3, 3]);
});

test('daily review rows reveal in order and reverse with scroll', () => {
  assert.deepEqual([0, 1, 2].map(index => workItemReveal(0.75, index)), [0, 0, 0]);
  assert.deepEqual([0, 1, 2].map(index => workItemReveal(1, index)), [1, 1, 1]);
  assert.ok(workItemReveal(0.81, 0) > 0);
  assert.equal(workItemReveal(0.81, 1), 0);
  assert.equal(workItemReveal(0.81, 2), 0);

  const forward = [0.79, 0.81, 0.84].map(progress => workItemReveal(progress, 0));
  const reverse = [0.84, 0.81, 0.79].map(progress => workItemReveal(progress, 0));
  assert.deepEqual(reverse, [...forward].reverse());
  assert.ok(forward[0] < forward[1] && forward[1] < forward[2]);
  assert.equal(workItemReveal(Number.NaN, 0), 0);
  assert.equal(workItemReveal(-1, 0), 0);
  assert.equal(workItemReveal(2, 2), 1);
});
