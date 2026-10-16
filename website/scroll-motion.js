const clamp = value => Math.min(1, Math.max(0, value));

export function viewportProgress(top, height, viewportHeight, start = 0.78, end = 0.22) {
  if (![top, height, viewportHeight].every(Number.isFinite) || height <= 0 || viewportHeight <= 0) return 0;
  return clamp((viewportHeight * start - top) / (height + viewportHeight * (start - end)));
}

export function pinnedProgress(top, runHeight, contentHeight, stickyTop = 76) {
  if (![top, runHeight, contentHeight, stickyTop].every(Number.isFinite)) return 0;
  const travel = runHeight - contentHeight;
  return travel > 0 ? clamp((stickyTop - top) / travel) : 0;
}

export function evidenceStage(progress) {
  const value = clamp(Number.isFinite(progress) ? progress : 0);
  if (value < 0.3) return 0;
  if (value < 0.58) return 1;
  if (value < 0.82) return 2;
  return 3;
}

export function chapterState(progress) {
  const value = clamp(Number.isFinite(progress) ? progress : 0) * 4;
  const index = Math.min(3, Math.floor(value));
  const local = Math.min(1, value - index);
  return { index, build: clamp(local * 4), detail: clamp((local - 0.25) * 3) };
}

export function workItemReveal(progress, index) {
  const local = clamp(((Number.isFinite(progress) ? progress : 0) - 0.75) * 4);
  const start = 0.08 + 0.24 * index;
  return clamp((local - start) / 0.18);
}

export function initScrollMotion() {
  const run = document.querySelector('#journey');
  if (!run) return () => {};
  const stage = run.querySelector('.chapter-stage');
  const chapters = [...run.querySelectorAll('[data-chapter]')];
  const links = [...run.querySelectorAll('[data-chapter-link]')];
  const workItems = [...run.querySelectorAll('.work-list li')];
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const compact = matchMedia('(max-height: 500px)');
  const stacked = () => reduced.matches || compact.matches;
  let frame = 0;
  let active = -1;
  document.body.dataset.scrollMotion = 'ready';

  function update() {
    frame = 0;
    const bounds = run.getBoundingClientRect();
    const progress = pinnedProgress(bounds.top, bounds.height, stage.offsetHeight, 0);
    const state = chapterState(progress);
    const index = stacked() ? Math.max(0, chapters.findLastIndex(chapter => chapter.getBoundingClientRect().top <= innerHeight * 0.45)) : state.index;
    const { build, detail } = state;
    run.style.setProperty('--journey-progress', progress.toFixed(3));
    chapters.forEach((chapter, i) => {
      const current = i === index;
      chapter.style.setProperty('--chapter-build', stacked() ? 1 : current ? build.toFixed(2) : 0);
      chapter.style.setProperty('--chapter-detail', stacked() ? 1 : current ? detail.toFixed(2) : 0);
      if (active !== index || stacked()) {
        chapter.dataset.active = String(current);
        chapter.dataset.past = String(i < index);
      }
      // Reduced motion is a normal, fully readable document, not a frozen pinned scene.
      chapter.inert = !stacked() && !current;
      chapter.setAttribute('aria-hidden', String(!stacked() && !current));
    });
    workItems.forEach((item, i) => {
      item.style.setProperty('--work-reveal', stacked() ? 1 : workItemReveal(progress, i).toFixed(2));
    });
    links.forEach((link, i) => {
      if (i === index) link.setAttribute('aria-current', 'true');
      else link.removeAttribute('aria-current');
    });
    active = index;
  }
  function schedule() { if (!frame) frame = requestAnimationFrame(update); }
  function goToChapter(index, focus = false) {
    if (stacked()) chapters[index].scrollIntoView({ behavior: 'auto', block: 'start' });
    else {
      const top = scrollY + run.getBoundingClientRect().top;
      const travel = run.offsetHeight - stage.offsetHeight;
      window.scrollTo({ top: top + travel * ((index + 0.7) / 4), behavior: 'auto' });
    }
    update();
    if (focus) {
      const heading = chapters[index].querySelector('h2');
      heading.tabIndex = -1;
      heading.focus({ preventScroll: true });
    }
  }
  function handleLink(event) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = event.target.closest('a[href^="#"]');
    if (!link) return;
    const index = chapters.findIndex(chapter => `#${chapter.id}` === link.hash);
    if (index < 0) return;
    event.preventDefault();
    history.pushState(null, '', link.hash);
    goToChapter(index, !event.detail);
  }
  function handleHash() {
    const index = chapters.findIndex(chapter => `#${chapter.id}` === location.hash);
    if (index >= 0) goToChapter(index);
  }
  window.addEventListener('scroll', schedule, { passive: true });
  window.addEventListener('resize', schedule);
  window.addEventListener('hashchange', handleHash);
  window.addEventListener('popstate', handleHash);
  document.addEventListener('click', handleLink);
  reduced.addEventListener('change', schedule);
  compact.addEventListener('change', schedule);
  update();
  if (location.hash) requestAnimationFrame(handleHash);
  return () => {
    cancelAnimationFrame(frame);
    window.removeEventListener('scroll', schedule);
    window.removeEventListener('resize', schedule);
    window.removeEventListener('hashchange', handleHash);
    window.removeEventListener('popstate', handleHash);
    document.removeEventListener('click', handleLink);
    reduced.removeEventListener('change', schedule);
    compact.removeEventListener('change', schedule);
    chapters.forEach(chapter => { chapter.inert = false; chapter.removeAttribute('aria-hidden'); });
    delete document.body.dataset.scrollMotion;
  };
}
