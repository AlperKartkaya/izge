import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const baseURL = process.env.WEBSITE_URL || 'http://127.0.0.1:5179';
assert.ok(['127.0.0.1', 'localhost'].includes(new URL(baseURL).hostname));
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    window.openingFrames = [];
    window.openingThinking = {};
    new MutationObserver(records => {
      for (const { target } of records) if (target.id === 'opening-thinking') {
        if (!target.hidden && !openingThinking.start) openingThinking.start = performance.now();
        else if (target.hidden && openingThinking.start && !openingThinking.end) openingThinking.end = performance.now();
      }
    }).observe(document, { subtree: true, attributes: true, attributeFilter: ['hidden'] });
    let previous = 0;
    function sample(now) {
      const logo = document.querySelector('.opening .memory-core');
      const section = document.querySelector('.opening-conversation');
      const step = Number(document.documentElement.dataset.introStep);
      if (logo && section && now - previous >= 80) {
        const bounds = logo.getBoundingClientRect();
        const opacity = el => getComputedStyle(el).display === 'none' ? 0 : Number(getComputedStyle(el).opacity);
        openingFrames.push({ step, x: bounds.x, y: bounds.y, logo: opacity(logo),
          copy: opacity(document.querySelector('.opening-copy')),
          header: opacity(document.querySelector('.site-header')),
          welcome: opacity(document.querySelector('.welcome-word')),
          graph: Number.parseFloat(getComputedStyle(document.querySelector('.opening .network-links path')).strokeDashoffset),
          docs: opacity(document.querySelector('.opening .orbit-document')),
          team: opacity(section), izge: opacity(section.querySelector('.izge-message')) });
        previous = now;
      }
      if (step < 6) requestAnimationFrame(sample);
    }
    requestAnimationFrame(sample);
  });
  await page.goto(baseURL);
  await page.waitForSelector('html[data-intro-step="0"]');
  await page.waitForSelector('body[data-scroll-motion="ready"]');
  assert.equal(await page.locator('#hero-title').evaluate(el => getComputedStyle(el.parentElement).opacity), '0');
  await page.screenshot({ path: '.impeccable/review/opening-blank.png' });
  assert.equal(await page.locator('#intro-toggle,#intro-skip,#intro-replay').count(), 0);
  assert.equal(await page.locator('.opening .graph-label').count(), 0);
  assert.equal(await page.locator('.opening-conversation mark').innerText(), '@izge');
  const welcomeAlignment = await page.locator('.welcome-word').evaluate(el => {
    const text = el.getBoundingClientRect();
    const logo = document.querySelector('.opening .memory-core').getBoundingClientRect();
    return Math.abs(text.left + text.width / 2 - logo.left - logo.width / 2);
  });
  assert.ok(welcomeAlignment < 1, 'Welcome text is centered under its logo');
  await page.waitForFunction(() => document.documentElement.dataset.introStep === '3');
  await page.screenshot({ path: '.impeccable/review/opening-graph.png' });
  await page.waitForSelector('#opening-thinking:not([hidden])');
  assert.equal(await page.locator('#opening-reply').isVisible(), false);
  const shimmer = await page.locator('#opening-thinking').evaluate(el => ({ animation: getComputedStyle(el).animationName, clip: getComputedStyle(el).backgroundClip, children: el.children.length }));
  assert.deepEqual(shimmer, { animation: 'opening-think-shimmer', clip: 'text', children: 0 }, 'Thinking uses only the supplied label shimmer, without a grid');
  await page.screenshot({ path: '.impeccable/review/opening-thinking.png' });
  await page.waitForFunction(() => {
    const el = document.querySelector('#opening-reply');
    return !el.hidden && el.textContent.length > 0 && el.textContent.length < el.dataset.en.length;
  });
  const thinkingDuration = await page.evaluate(() => openingThinking.end - openingThinking.start);
  assert.ok(thinkingDuration >= 1800 && thinkingDuration < 3000, 'Thinking lasts about two seconds');
  await page.screenshot({ path: '.impeccable/review/opening-stream.png' });
  await page.waitForFunction(() => { const el = document.querySelector('#opening-reply'); return el.textContent === el.dataset.en; });
  await page.screenshot({ path: '.impeccable/review/opening-settled.png' });
  const frames = await page.evaluate(() => openingFrames);
  assert.ok(frames.filter(f => f.step === 0).every(f => f.copy === 0 && f.header === 0), 'Welcome begins without top content');
  const fade = frames.filter(f => f.step === 1);
  assert.ok(fade.some(f => f.copy > 0 && f.header > 0 && f.welcome > 0 && f.welcome < 1), 'Top content appears while welcome text fades');
  assert.ok(fade.every(f => Math.abs(f.x - fade[0].x) < 1), 'Logo holds still until welcome text disappears');
  assert.ok(frames.filter(f => f.step < 3).every(f => f.docs === 0 && f.team === 0 && f.graph === 3200), 'Sources and graph wait for logo arrival');
  const arrival = frames.filter(f => f.step === 3);
  assert.ok(arrival.slice(0, 3).some(f => f.graph < 3200), 'Graph begins drawing immediately on arrival');
  assert.ok(frames.some(f => f.step === 4 && f.team > .8 && f.izge === 0), 'Ece appears before Izge');
  const exit = frames.filter(f => f.step === 2);
  assert.ok(exit.some(f => f.logo === 0), 'Logo fully disappears before changing position');
  assert.ok(exit.every(f => f.welcome === 0 && Math.abs(f.x - fade[0].x) < 1 && Math.abs(f.y - fade[0].y) < 1), 'Logo fades at its welcome position without sliding');
  assert.ok(arrival.some(f => f.logo > 0 && f.logo < 1), 'Logo fades back in at the graph center');
  assert.ok(arrival.every(f => Math.abs(f.x - arrival[0].x) < 1 && Math.abs(f.y - arrival[0].y) < 1), 'Graph logo never slides');
  assert.ok(exit[0].x - arrival[0].x > 200, 'Logo reappears at its distinct graph position');


  for (const delay of [2400, 5400]) {
    const slow = await browser.newPage();
    await slow.addInitScript(() => {
      window.introStates = [];
      new MutationObserver(() => introStates.push(document.documentElement.getAttribute('data-intro-step')))
        .observe(document, { subtree: true, attributes: true, attributeFilter: ['data-intro-step'] });
    });
    await slow.route('**/journey-motion.js', async route => {
      await new Promise(resolve => setTimeout(resolve, delay));
      await route.continue();
    });
    await slow.goto(baseURL);
    await slow.waitForSelector('html[data-intro-ready="true"]');
    const states = await slow.evaluate(() => introStates);
    if (delay < 5000) assert.ok(!states.includes(null), 'Slow module stays in one opening instead of failing open then replaying');
    else {
      assert.ok(states.includes(null), 'Failed boot still reveals readable content');
      assert.ok(states.slice(states.indexOf(null) + 1).every(step => step === '6'), 'Late boot never restarts a page already revealed by fallback');
      assert.equal(await slow.locator('html').getAttribute('data-intro-step'), '6');
    }
    await slow.close();
  }
  for (let index = 0; index < 4; index++) {
    await page.locator(`[data-chapter-link="${index}"]`).click();
    await page.waitForFunction(i => document.querySelector(`[data-chapter="${i}"]`).dataset.active === 'true', index);
    await page.waitForTimeout(1300);
    assert.equal(await page.locator('.chapter:not([inert])').count(), 1);
    const fits = await page.locator(`[data-chapter="${index}"]`).evaluate(el => {
      const bounds = el.getBoundingClientRect();
      return [...el.children].every(child => child.getBoundingClientRect().bottom <= innerHeight - 20) && bounds.top >= 0;
    });
    assert.equal(fits, true, `Desktop chapter ${index} fits`);
    await page.screenshot({ path: `.impeccable/review/chapter-${index}.png` });
  }
  for (const [local, expected] of [[.04, [0,0,0]], [.3, [1,0,0]], [.55, [1,1,0]], [.8, [1,1,1]], [.04, [0,0,0]]]) {
    await page.evaluate(local => { const r = document.querySelector('#journey'); const stage = r.querySelector('.chapter-stage'); scrollTo(0, r.offsetTop + (r.offsetHeight - stage.offsetHeight) * ((3 + local) / 4)); }, local);
    await page.waitForTimeout(700);
    const values = await page.locator('.work-list li').evaluateAll(items => items.map(el => Number(el.style.getPropertyValue('--work-reveal'))));
    assert.deepEqual(values, expected, `Daily review sequential reveal ${local}`);
  }
  await page.setViewportSize({ width: 375, height: 667 });
  for (let index = 0; index < 4; index++) {
    await page.locator(`[data-chapter-link="${index}"]`).click();
    await page.waitForTimeout(1100);
    const bounds = await page.locator(`[data-chapter="${index}"]`).evaluate(el => [...el.children].map(child => {
      const r = child.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, right: r.right };
    }));
    assert.ok(bounds.every(r => r.top >= 50 && r.bottom <= 640 && r.right <= 375), `Mobile chapter ${index} fits: ${JSON.stringify(bounds)}`);
    await page.screenshot({ path: `.impeccable/review/chapter-mobile-${index}.png` });
  }
  // A fresh document isolates team progression from browser scroll anchoring during viewport changes.
  await page.goto(baseURL);
  await page.waitForSelector('body[data-scroll-motion="ready"]');
  const scrollFinale = async progress => {
    await page.evaluate(progress => {
      const run = document.querySelector('.finale-run');
      scrollTo(0, run.offsetTop + (run.offsetHeight - innerHeight) * progress);
    }, progress);
    await page.waitForTimeout(120);
  };
  await scrollFinale(0);
  assert.equal(await page.locator('.finale-stage').evaluate(el => Math.round(el.getBoundingClientRect().top)), 0);
  assert.equal(await page.locator('#bring-izge').isVisible(), true);
  await scrollFinale(.04);
  assert.equal(await page.locator('#discussion-messages .message').count(), 0, 'No pre-existing Ece message');
  assert.ok(await page.locator('.team-composer').evaluate(el => {
    const style = getComputedStyle(el); const matrix = new DOMMatrixReadOnly(style.transform);
    return Number(style.opacity) === 1 && matrix.m22 === 1 && matrix.m42 < 0;
  }), 'Composer moves up without shrinking or disappearing');
  await scrollFinale(.1);
  await page.waitForSelector('[data-motion-message="thinking"]');
  assert.equal(await page.locator('[data-motion-message="question"] .message-name').innerText(), 'You');
  assert.equal(await page.locator('[data-motion-message="question"]').evaluate(el => el.classList.contains('self-message')), true);
  assert.equal(await page.locator('.hero-motion__header').count(), 0);
  await page.waitForSelector('.hero-motion__stream');
  const pause = page.locator('.hero-motion__control').first();
  await pause.click();
  const before = await page.locator('.hero-motion__stream').innerText();
  await scrollFinale(.2);
  await page.waitForTimeout(400);
  assert.equal(await page.locator('.hero-motion__stream').innerText(), before, 'Scroll respects pause');
  await pause.click();
  await page.waitForSelector('.hero-motion__stream.is-complete', { timeout: 8000 });
  assert.equal(await page.locator('[data-motion-message="reaction"]').count(), 0, 'Reactions wait for more scroll');
  assert.equal(await page.locator('[data-motion-message="answer"] [data-source]').count(), 3);
  await scrollFinale(.49);
  await page.waitForSelector('[data-motion-message="reaction"]');
  assert.equal(await page.locator('[data-motion-message="congratulations"]').count(), 0);
  await scrollFinale(.65);
  await page.waitForSelector('.hero-motion.is-complete');
  await page.waitForTimeout(600);
  assert.equal(await page.locator('[data-motion-message="congratulations"]').evaluate(el => getComputedStyle(el).opacity), '1');
  assert.equal(await page.locator('.team-workspace').evaluate(el => el.getBoundingClientRect().bottom <= innerHeight), true);
  await page.screenshot({ path: '.impeccable/review/team-stream.png' });
  await scrollFinale(.88);
  const mid = await page.locator('.closing-section h2').boundingBox();
  await scrollFinale(1);
  const end = await page.locator('.closing-section h2').boundingBox();
  assert.ok(end.width > mid.width && end.y < mid.y, 'Closing rises and grows with scroll');
  assert.equal(await page.locator('.team-section').evaluate(el => el.inert), true);
  assert.equal(await page.locator('.closing-section').evaluate(el => el.inert), false);
  assert.equal(await page.locator('.contact-button').getAttribute('href'), 'mailto:alperkartkaya@gmail.com');
  await page.screenshot({ path: '.impeccable/review/closing-mobile.png' });
  await scrollFinale(.49);
  assert.equal(await page.locator('[data-motion-message="congratulations"]').count(), 0);
  assert.equal(await page.locator('[data-motion-message="reaction"]').count(), 1);
  await scrollFinale(.35);
  assert.equal(await page.locator('[data-motion-message="reaction"]').count(), 0);
  assert.equal(await page.locator('[data-motion-message="thinking"]').count(), 0);
  assert.ok(await page.locator('.hero-motion__stream').evaluate(el => el.textContent.length < el.getAttribute('aria-label').length));
  const reverseText = await page.locator('.hero-motion__stream').innerText();
  await page.waitForTimeout(350);
  assert.equal(await page.locator('.hero-motion__stream').innerText(), reverseText, 'Reverse state holds while scroll stops');
  await scrollFinale(.2);
  assert.equal(await page.locator('[data-motion-message="answer"]').count(), 0);
  assert.equal(await page.locator('[data-motion-message="thinking"]').count(), 1);
  await scrollFinale(.04);
  assert.equal(await page.locator('#discussion-messages .message').count(), 0);
  assert.equal(await page.locator('#bring-izge').isVisible(), true);
  await scrollFinale(.65);
  await page.reload();
  await page.waitForSelector('body[data-scroll-motion="ready"]');
  assert.equal(await page.evaluate(() => scrollY), 0, 'Reload restarts at top');
  await scrollFinale(1);
  await page.evaluate(() => history.replaceState(null, '', '#discussion'));
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Page.reload', { ignoreCache: true });
  await page.waitForTimeout(700);
  await page.waitForSelector('body[data-scroll-motion="ready"]');
  assert.equal(await page.evaluate(() => scrollY), 0, 'Hard reload restarts at top');
  assert.equal(await page.evaluate(() => location.hash), '');
  assert.equal(await page.locator('#discussion-messages .message').count(), 0);
  await cdp.detach();
  await page.locator('[data-language="tr"]').click();
  for (let index = 0; index < 4; index++) {
    await page.locator(`[data-chapter-link="${index}"]`).click();
    await page.waitForTimeout(1000);
    const fits = await page.locator(`[data-chapter="${index}"]`).evaluate(el => [...el.children].every(child => {
      const r = child.getBoundingClientRect(); return r.top >= 50 && r.bottom <= 640 && r.right <= 375;
    }));
    assert.ok(fits, `Turkish mobile chapter ${index} fits`);
  }
  await page.setViewportSize({ width: 844, height: 390 });
  await page.waitForFunction(() => document.querySelectorAll('.chapter[inert]').length === 0);
  for (const chapter of await page.locator('.chapter').all()) assert.equal(await chapter.isVisible(), true);
  await page.setViewportSize({ width: 375, height: 667 });
  await page.locator('#discussion').scrollIntoViewIfNeeded();
  assert.equal(await page.locator('html').getAttribute('lang'), 'tr');
  assert.equal((await page.locator('#hero-title').innerText()).trim(), 'Ekibinizden biri.');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  if (await page.locator('#bring-izge').isVisible()) await page.locator('#bring-izge').click();
  await page.waitForFunction(() => document.querySelectorAll('.chapter[inert]').length === 0);
  await page.waitForSelector('.hero-motion.is-complete');
  assert.deepEqual(errors, []);
  console.log('PASS: finite intro with thinking/stream and no controls, 4 pinned scenes, mobile scene fit, sequential daily review, upward self-send, reversible scroll, reload reset, faster stream, pause, scroll-gated reactions, closing handoff, contact, language, reduced motion');
} finally {
  await Promise.all(browser.contexts().map(context => context.close()));
  await browser.close();
}
