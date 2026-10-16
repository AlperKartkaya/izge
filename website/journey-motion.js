export const INTRO_DURATION = 12_000;
export const introStep = elapsed => [900, 1100, 1400, 2650, 3450, 7450].filter(time => elapsed >= time).length;

export function openingReplyState(elapsed) {
  if (elapsed < 3450) return { thinking: false, progress: 0 };
  if (elapsed < 5450) return { thinking: true, progress: 0 };
  return { thinking: false, progress: Math.min(1, (elapsed - 5450) / 2000) };
}

export function setupJourneyIntro(getLanguage) {
  const root = document.documentElement;
  const alreadyRevealed = !root.hasAttribute('data-intro-step');
  root.dataset.introReady = 'true';
  const section = document.querySelector('.opening');
  const reply = document.querySelector('#opening-reply');
  const thinking = document.querySelector('#opening-thinking');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let elapsed = 0;
  let previous = 0;
  let frame = 0;
  let inView = true;
  let step = -1;

  function renderReply() {
    if (!reply || !thinking) return;
    const state = openingReplyState(elapsed);
    const language = getLanguage() === 'tr' ? 'tr' : 'en';
    const fullReply = reply.dataset[language] || '';
    const thinkingCopy = thinking.dataset[language] || '';
    if (thinking.textContent !== thinkingCopy) thinking.textContent = thinkingCopy;
    thinking.hidden = !state.thinking;
    reply.textContent = fullReply.slice(0, Math.floor(fullReply.length * state.progress));
    reply.hidden = state.progress === 0;
  }
  function render() {
    const next = introStep(elapsed);
    if (step !== next) {
      root.dataset.introStep = String(next);
      step = next;
    }
    renderReply();
  }
  function tick(now) {
    frame = 0;
    if (previous) elapsed = Math.min(INTRO_DURATION, elapsed + now - previous);
    previous = now;
    render();
    if (elapsed < INTRO_DURATION) frame = requestAnimationFrame(tick);
  }
  function stop() {
    cancelAnimationFrame(frame);
    frame = 0;
    previous = 0;
  }
  function start() {
    if (!frame && !document.hidden && inView && elapsed < INTRO_DURATION) frame = requestAnimationFrame(tick);
  }
  function complete() {
    stop();
    elapsed = INTRO_DURATION;
    render();
  }
  // Hidden entrances must never swallow a keyboard user's destination.
  document.querySelector('.site-header').addEventListener('focusin', complete);
  section.addEventListener('focusin', complete);
  document.addEventListener('visibilitychange', () => document.hidden ? stop() : start());
  document.addEventListener('izge:language', renderReply);
  window.addEventListener('scroll', () => { if (scrollY > 80 && elapsed < INTRO_DURATION) complete(); }, { passive: true });
  const observer = new IntersectionObserver(([entry]) => {
    inView = entry.isIntersecting;
    if (inView) start(); else stop();
  });
  observer.observe(section);
  reduced.addEventListener('change', event => { if (event.matches) complete(); });
  if (alreadyRevealed || reduced.matches || scrollY > 80) complete(); else { render(); start(); }
}
