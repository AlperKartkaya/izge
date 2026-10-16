const clamp = value => Math.min(1, Math.max(0, value));

export function finaleState(progress) {
  const conversation = clamp(progress / .76);
  return {
    conversation,
    send: clamp((conversation - .025) / .095),
    closing: clamp((progress - .76) / .24),
  };
}

export function initFinaleMotion({ advance }) {
  const run = document.querySelector('.finale-run');
  const stage = run?.querySelector('.finale-stage');
  if (!stage) return;
  const team = stage.querySelector('.team-section');
  const closing = stage.querySelector('.closing-section');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  const compact = matchMedia('(max-height: 500px)');
  let frame = 0;
  let lastY = scrollY;
  let lastTime = performance.now();
  let scrolled = false;

  function update(now) {
    frame = 0;
    const enabled = !reduce.matches && !compact.matches;
    run.dataset.motion = enabled ? 'ready' : 'static';
    const bounds = run.getBoundingClientRect();
    const progress = clamp(-bounds.top / Math.max(1, bounds.height - stage.offsetHeight));
    const state = finaleState(progress);
    const velocity = scrolled ? (scrollY - lastY) / Math.max(16, now - lastTime) : 0;
    lastY = scrollY;
    lastTime = now;
    scrolled = false;
    const composer = stage.querySelector('.team-composer');
    if (enabled && !composer.hidden) {
      const button = composer.querySelector('button');
      const transform = new DOMMatrixReadOnly(getComputedStyle(composer).transform);
      const origin = button.getBoundingClientRect().top - transform.m42;
      const messages = stage.querySelector('.message-list');
      const destination = messages.getBoundingClientRect().top + parseFloat(getComputedStyle(messages).paddingTop) + 24;
      stage.style.setProperty('--send-distance', `${destination - origin}px`);
    }
    stage.style.setProperty('--send-progress', state.send);
    stage.style.setProperty('--closing-progress', state.closing);
    team.inert = enabled && state.closing > .65;
    closing.inert = enabled && state.closing < .65;
    team.setAttribute('aria-hidden', String(team.inert));
    closing.setAttribute('aria-hidden', String(closing.inert));
    if (enabled) advance(state.conversation, velocity);
  }
  function schedule() { if (!frame) frame = requestAnimationFrame(update); }
  function onScroll() { scrolled = true; schedule(); }
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', schedule);
  document.addEventListener('izge:language', schedule);
  document.addEventListener('izge:conversation', schedule);
  reduce.addEventListener('change', schedule);
  compact.addEventListener('change', schedule);
  // First frame establishes the native sticky geometry before measuring its travel.
  run.dataset.motion = !reduce.matches && !compact.matches ? 'ready' : 'static';
  schedule();
  return () => {
    cancelAnimationFrame(frame);
    window.removeEventListener('scroll', onScroll);
    window.removeEventListener('resize', schedule);
    document.removeEventListener('izge:language', schedule);
    document.removeEventListener('izge:conversation', schedule);
    reduce.removeEventListener('change', schedule);
    compact.removeEventListener('change', schedule);
    delete run.dataset.motion;
    team.inert = closing.inert = false;
    team.removeAttribute('aria-hidden');
    closing.removeAttribute('aria-hidden');
  };
}
