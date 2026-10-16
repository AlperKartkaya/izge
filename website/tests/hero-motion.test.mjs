import assert from 'node:assert/strict';
import test from 'node:test';

import { buildHeroTimeline } from '../hero-motion.js';

for (const language of ['en', 'tr']) {
  test(`builds a grounded, deterministic ${language} hero conversation`, () => {
    const timeline = buildHeroTimeline(language);
    const stream = timeline.events.find(({ type }) => type === 'stream');
    const messages = timeline.events.filter(({ type }) => type === 'message');

    assert.equal(timeline.language, language);
    assert.ok(timeline.duration >= 16_000 && timeline.duration <= 22_000);
    assert.deepEqual(timeline.events.map(({ at }) => at), [...timeline.events.map(({ at }) => at)].sort((a, b) => a - b));
    assert.match(messages[0].message.body, /@izge/i);
    assert.doesNotMatch(stream.message.body, /^(?:Illustrative review|Temsili inceleme):/);
    assert.match(stream.message.body, language === 'en' ? /^The invoice/ : /^Faturada/);
    assert.match(stream.message.body, language === 'en' ? /18 out-of-scope hours/ : /18 saatlik kapsam dışı iş/);
    assert.match(stream.message.body, language === 'en' ? /36,000 \+ VAT/ : /36\.000 TL \+ KDV/);
    assert.equal(messages.at(-1).message.name, 'Selin');
    assert.match(messages.at(-1).message.body, language === 'en' ? /review the delivery evidence/ : /teslim kanıtını.*inceleyeceğim/);
  });
}

test('falls back to English for unsupported locales', () => {
  assert.equal(buildHeroTimeline('de').language, 'en');
});
