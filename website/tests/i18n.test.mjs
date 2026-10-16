import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { initialLanguage, normalizeLanguage, translatePage } from '../i18n.js';
test('uses only supported languages and falls back when storage is unavailable', () => {
  assert.equal(normalizeLanguage('tr'), 'tr');
  for (const value of ['en', null, 'fr', '<script>']) assert.equal(normalizeLanguage(value), 'en');
  assert.equal(initialLanguage({ getItem: () => 'tr' }), 'tr');
  assert.equal(initialLanguage({ getItem: () => { throw Error('denied'); } }), 'en');
});
test('tab title stays the requested Turkish brand line in both languages', () => {
  const root = { documentElement: {}, querySelectorAll: () => [], querySelector: () => ({ content: '' }) };
  for (const language of ['en', 'tr']) {
    translatePage(language, root);
    assert.equal(root.title, 'İzge - Ekip arkadaşınız');
  }
});
test('tab metadata uses the current logo with cache-busted SVG and PNG icons', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /<title>İzge - Ekip arkadaşınız<\/title>/);
  assert.match(html, /rel="icon" type="image\/svg\+xml" href="\.\/assets\/favicon\.svg\?v=12"/);
  assert.match(html, /rel="icon" type="image\/png" sizes="32x32" href="\.\/assets\/favicon-32\.png\?v=12"/);
  const favicon = await readFile(new URL('../assets/favicon.svg', import.meta.url), 'utf8');
  const logo = await readFile(new URL('../assets/izge-mark.svg', import.meta.url), 'utf8');
  for (const path of logo.matchAll(/\bd="([^"]+)"/g)) assert.ok(favicon.includes(`d="${path[1]}"`));
});
