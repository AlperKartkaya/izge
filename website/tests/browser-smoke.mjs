import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const baseURL = process.env.WEBSITE_URL || 'http://127.0.0.1:5179';
assert.ok(['127.0.0.1', 'localhost'].includes(new URL(baseURL).hostname));
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const errors = [];
const output = '.impeccable/review';
await mkdir(output, { recursive: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, reducedMotion: 'reduce' });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(baseURL);
  await page.waitForSelector('body[data-scroll-motion="ready"]');
  await page.evaluate(() => document.fonts.ready);
  assert.equal(await page.locator('html').getAttribute('data-intro-step'), '6');
  assert.equal(await page.title(), 'İzge - Ekip arkadaşınız');
  assert.equal(await page.locator('link[rel=icon][type="image/svg+xml"]').getAttribute('href'), './assets/favicon.svg?v=12');
  const broken = await page.locator('a[href^="#"]').evaluateAll(links => links.filter(a => !document.getElementById(a.hash.slice(1))).map(a => a.hash));
  assert.deepEqual(broken, []);
  await page.locator('[data-source="contract"]').first().click();
  assert.equal(await page.locator('#source-dialog').evaluate(el => el.open), true);
  assert.match(await page.locator('#source-body').innerText(), /2,000|2.000/);
  await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(() => document.activeElement.dataset.source), 'contract');
  await page.locator('#bring-izge').click();
  assert.equal(await page.locator('[data-motion-message="answer"]').count(), 1);
  await page.locator('[data-conversation="private"]').click();
  assert.equal(await page.locator('#discussion-messages .message').count(), 2);
  await page.locator('[data-conversation="team"]').click();
  await page.locator('[data-language="tr"]').click();
  await page.reload();
  assert.equal(await page.locator('html').getAttribute('lang'), 'tr');
  for (const [source, selector] of [['contract', 'strong'], ['delivery', 'ul'], ['invoice', 'table']]) {
    await page.locator(`[data-source="${source}"]`).first().click();
    assert.ok(await page.locator(`#source-body ${selector}`).count() > 0, `${source} is rendered Markdown`);
    assert.doesNotMatch(await page.locator('#source-body').innerText(), /^# |\*\*|\|---/m);
    await page.keyboard.press('Escape');
  }
  assert.equal(await page.locator('.contact-button').getAttribute('href'), 'mailto:alperkartkaya@gmail.com');
  assert.equal(await page.locator('.opening-disclosure,.team-disclosure').count(), 0);

  for (const language of ['tr', 'en']) {
    await page.locator(`[data-language="${language}"]`).click();
    assert.equal(await page.title(), 'İzge - Ekip arkadaşınız');
    for (const [width, height] of [[375, 667], [390, 844], [768, 960], [1280, 800], [1440, 960], [844, 390]]) {
      await page.setViewportSize({ width, height });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `No ${language} overflow ${width}x${height}`);
    }
  }
  assert.equal(await page.locator('.chapter[inert]').count(), 0, 'Reduced motion keeps all chapters readable');
  for (const [width, height, name] of [[1440, 960, 'desktop'], [390, 844, 'mobile']]) {
    // Fresh contexts avoid stale compositor tiles after landscape/responsive resizing.
    const capture = await browser.newPage({ viewport: { width, height }, reducedMotion: 'reduce' });
    await capture.goto(baseURL);
    await capture.evaluate(() => document.fonts.ready);
    await capture.waitForTimeout(700);
    await capture.screenshot({ path: `${output}/${name}.png`, fullPage: true });
    await capture.close();
  }
  const noJS = await browser.newPage({ javaScriptEnabled: false });
  await noJS.goto(baseURL);
  assert.equal(await noJS.locator('.chapter:visible').count(), 4);
  assert.equal(await noJS.locator('#hero-title').isVisible(), true);
  await noJS.close();
  assert.deepEqual(errors, []);
  console.log('PASS: sources, focus/Escape, bilingual persistence, 12 responsive cases, reduced motion, no-JS, browser errors');
} finally { await browser.close(); }
