import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { story } from '../story-data.js';

const fixtureRoot = new URL('../../backend/manual_eval/pusula_demo/preloaded/', import.meta.url);
const expectedIds = ['contract', 'delivery', 'invoice'];

test('keeps the bilingual story shape and source parity', () => {
  assert.deepEqual(Object.keys(story).sort(), ['en', 'tr']);

  for (const language of ['en', 'tr']) {
    const version = story[language];
    assert.deepEqual(version.sources.map(({ id }) => id), expectedIds);
    assert.deepEqual(Object.keys(version.finding).sort(), ['amount', 'answer', 'qualification', 'title']);
    assert.ok(version.team.length >= 3 && version.team.length <= 4);
    assert.equal(version.private.length, 2);

    for (const message of [...version.team, ...version.private]) {
      assert.ok(['Ece', 'Selin', 'Izge'].includes(message.name));
      assert.ok(['person', 'izge'].includes(message.role));
      assert.ok(message.body.length > 0);
    }
  }
});

test('preserves the complete Turkish source files verbatim', async () => {
  for (const source of story.tr.sources) {
    const fixture = await readFile(new URL(source.filename, fixtureRoot), 'utf8');
    assert.equal(source.body, fixture);
  }
});

test('grounds the finding arithmetic in the source fixtures', async () => {
  const contract = await readFile(new URL('01_atlas_hizmet_sozlesmesi.md', fixtureRoot), 'utf8');
  const invoice = await readFile(new URL('02_atlas_eylul_faturasi.md', fixtureRoot), 'utf8');
  const delivery = await readFile(new URL('03_atlas_ek_is_teslim_ve_gunlukler.md', fixtureRoot), 'utf8');

  assert.match(contract, /2\.000 TL \+ KDV/);
  assert.match(invoice, /85\.000 TL/);
  assert.match(delivery, /6 saat/);
  assert.match(delivery, /4 saat/);
  assert.match(delivery, /8 saat/);
  assert.match(delivery, /18 × 2\.000 TL = 36\.000 TL \+ KDV/);
  assert.equal(6 + 4 + 8, 18);
  assert.equal(18 * 2_000, 36_000);

  assert.match(story.en.finding.amount, /₺36,000 \+ VAT/);
  assert.match(story.tr.finding.amount, /36\.000 TL \+ KDV/);
});

test('keeps approval and authority boundaries explicit', () => {
  for (const language of ['en', 'tr']) {
    const serialized = JSON.stringify(story[language]);
    assert.match(serialized, language === 'en' ? /Customer confirmation and commercial approval are required/ : /Müşteri teyidi ve ticari onay gerekir/);
    assert.match(serialized, language === 'en' ? /not recovered revenue or a finalized receivable/ : /kurtarılmış gelir veya kesinleşmiş alacak değildir/);
    assert.match(serialized, language === 'en' ? /Human review remains required/ : /İnsan incelemesi gerekiyor/);
    assert.doesNotMatch(serialized, /\b(?:Slack|Microsoft Teams|ERP|CRM|QuickBooks|Xero)\b/iu);
  }
});
