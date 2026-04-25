const root = document.documentElement;
const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const canvas = document.querySelector('#memory-field');
const context = canvas?.getContext('2d');
const scenes = Array.from(document.querySelectorAll('.scene'));
const scenarioSections = Array.from(document.querySelectorAll('[data-scenario-section]'));
const weaveStages = Array.from(document.querySelectorAll('[data-memory-weave]'));
const navLinks = Array.from(document.querySelectorAll('.top-nav a[href^="#"]'));
const navTargets = navLinks
  .map(link => ({ link, target: document.querySelector(link.getAttribute('href')) }))
  .filter(item => item.target);
let width = 0;
let height = 0;
let nodes = [];
let trace = 0;

function resizeCanvas() {
  if (!canvas || !context) return;
  const scale = Math.min(window.devicePixelRatio || 1, 2);
  width = window.innerWidth;
  height = window.innerHeight;
  canvas.width = Math.floor(width * scale);
  canvas.height = Math.floor(height * scale);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  context.setTransform(scale, 0, 0, scale, 0, 0);
  const count = prefersReducedMotion ? 18 : Math.min(58, Math.floor(width / 24));
  nodes = Array.from({ length: count }, (_, index) => ({
    x: (Math.sin(index * 91.7) * 0.5 + 0.5) * width,
    y: (Math.cos(index * 47.3) * 0.5 + 0.5) * height,
    r: 1 + ((index * 7) % 13) / 10,
    phase: index * 0.37,
  }));
}

function draw(time = 0) {
  if (!canvas || !context) return;
  context.clearRect(0, 0, width, height);
  const scroll = Number.parseFloat(root.style.getPropertyValue('--scroll') || '0');
  const drift = prefersReducedMotion ? 0 : time * 0.00008;

  nodes.forEach((node, index) => {
    const x = node.x + Math.sin(drift * 9 + node.phase) * 18;
    const y = node.y + Math.cos(drift * 7 + node.phase) * 14 + scroll * (index % 5) * 18;

    for (let nextIndex = index + 1; nextIndex < nodes.length; nextIndex += 1) {
      const other = nodes[nextIndex];
      const ox = other.x + Math.sin(drift * 9 + other.phase) * 18;
      const oy = other.y + Math.cos(drift * 7 + other.phase) * 14 + scroll * (nextIndex % 5) * 18;
      const distance = Math.hypot(x - ox, y - oy);
      if (distance < 150) {
        context.beginPath();
        context.moveTo(x, y);
        context.lineTo(ox, oy);
        context.strokeStyle = `rgba(139,149,157,${0.055 * (1 - distance / 150)})`;
        context.lineWidth = 1;
        context.stroke();
      }
    }

    context.beginPath();
    context.arc(x, y, node.r, 0, Math.PI * 2);
    context.fillStyle = 'rgba(216,220,221,0.26)';
    context.fill();
  });

  if (!prefersReducedMotion && nodes.length > 3) {
    trace = (trace + 0.011 + scroll * 0.002) % 1;
    const a = nodes[Math.floor(trace * nodes.length) % nodes.length];
    const b = nodes[(Math.floor(trace * nodes.length) + 9) % nodes.length];
    context.beginPath();
    context.moveTo(a.x, a.y);
    context.quadraticCurveTo(width * 0.5, height * (0.15 + scroll * 0.7), b.x, b.y);
    context.strokeStyle = 'rgba(95,117,99,0.34)';
    context.lineWidth = 1.5;
    context.stroke();
  }

  if (!prefersReducedMotion) requestAnimationFrame(draw);
}

function updateScroll() {
  const max = document.documentElement.scrollHeight - window.innerHeight;
  const progress = max > 0 ? window.scrollY / max : 0;
  root.style.setProperty('--scroll', progress.toFixed(4));

  scenes.forEach(scene => {
    const rect = scene.getBoundingClientRect();
    const rawProgress = (window.innerHeight - rect.top) / (window.innerHeight + rect.height);
    const sceneProgress = Math.min(1, Math.max(0, rawProgress));
    const visibleTop = Math.max(rect.top, 0);
    const visibleBottom = Math.min(rect.bottom, window.innerHeight);
    const visiblePixels = Math.max(0, visibleBottom - visibleTop);
    const visibility = Math.min(1, visiblePixels / Math.min(rect.height, window.innerHeight));
    const presence = Math.min(1, Math.max(0.62, 0.62 + visibility * 0.38));

    scene.style.setProperty('--scene-progress', sceneProgress.toFixed(4));
    scene.style.setProperty('--scene-presence', presence.toFixed(4));
    scene.classList.toggle('is-current-scene', visibility > 0.48);
  });

  let activeNav = null;
  let activeNavScore = 0;
  navTargets.forEach(({ link, target }) => {
    const rect = target.getBoundingClientRect();
    const visibleTop = Math.max(rect.top, 0);
    const visibleBottom = Math.min(rect.bottom, window.innerHeight);
    const visiblePixels = Math.max(0, visibleBottom - visibleTop);
    const visibility = Math.min(1, visiblePixels / Math.min(rect.height, window.innerHeight));
    const centerDistance = Math.abs(rect.top + rect.height * 0.5 - window.innerHeight * 0.5);
    const centerScore = 1 - Math.min(1, centerDistance / window.innerHeight);
    const score = visibility * 0.72 + centerScore * 0.28;

    if (visibility > 0.08 && score > activeNavScore) {
      activeNav = link;
      activeNavScore = score;
    }
  });
  navLinks.forEach(link => {
    const isActive = link === activeNav;
    link.classList.toggle('is-active', isActive);
    if (isActive) link.setAttribute('aria-current', 'true');
    else link.removeAttribute('aria-current');
  });

  scenarioSections.forEach(section => {
    const rect = section.getBoundingClientRect();
    const rawProgress = (window.innerHeight * 0.45 - rect.top) / Math.max(rect.height - window.innerHeight * 0.3, 1);
    const scenarioProgress = Math.min(1, Math.max(0, rawProgress));
    const panels = Array.from(section.querySelectorAll('[data-scenario-step]'));
    let activeIndex = 0;
    let activeDistance = Number.POSITIVE_INFINITY;

    panels.forEach((panel, index) => {
      const panelRect = panel.getBoundingClientRect();
      const panelCenter = panelRect.top + panelRect.height * 0.5;
      const distance = Math.abs(panelCenter - window.innerHeight * 0.5);
      if (distance < activeDistance) {
        activeDistance = distance;
        activeIndex = index;
      }
    });

    if (rect.top > window.innerHeight * 0.62) activeIndex = 0;
    if (rect.bottom < window.innerHeight * 0.42) activeIndex = panels.length - 1;

    section.dataset.activeStep = String(activeIndex);
    section.style.setProperty('--scenario-progress', scenarioProgress.toFixed(4));
    panels.forEach((panel, index) => panel.classList.toggle('is-active', index === activeIndex));
  });
}

const revealObserver = new IntersectionObserver(
  entries => {
    entries.forEach(entry => {
      if (entry.isIntersecting) entry.target.classList.add('is-visible');
    });
  },
  { threshold: 0.18, rootMargin: '0px 0px -10% 0px' },
);

function revealVisibleElements() {
  document.querySelectorAll('[data-reveal]').forEach(element => {
    const rect = element.getBoundingClientRect();
    const isVisible = rect.top < window.innerHeight * 0.92 && rect.bottom > window.innerHeight * 0.04;
    if (isVisible) element.classList.add('is-visible');
  });
}

function setWeaveState(stage, nextState, options = {}) {
  const panels = Array.from(stage.querySelectorAll('[data-weave-panel]'));
  const triggers = Array.from(stage.querySelectorAll('[data-weave-trigger]'));
  const maxState = Math.max(0, panels.length - 1);
  const activeState = Math.max(0, Math.min(Number.parseInt(nextState, 10) || 0, maxState));

  if (options.userInitiated) {
    stage.dataset.userControlled = 'true';
    stage._weaveTimers?.forEach(timer => window.clearTimeout(timer));
  }

  if (options.pin) {
    stage.dataset.pinned = 'true';
  }

  stage.dataset.activeState = String(activeState);
  panels.forEach(panel => panel.classList.toggle('is-active', panel.dataset.weavePanel === String(activeState)));
  triggers.forEach(trigger => {
    const isActive = trigger.dataset.weaveTrigger === String(activeState);
    trigger.classList.toggle('is-active', isActive);
    trigger.setAttribute('aria-pressed', String(isActive));
  });
}

function initializeMemoryWeaves() {
  const supportsHover = window.matchMedia('(hover: hover) and (pointer: fine)').matches;

  weaveStages.forEach(stage => {
    const triggers = Array.from(stage.querySelectorAll('[data-weave-trigger]'));
    const initialState = prefersReducedMotion ? 4 : 0;
    const timers = [];
    stage._weaveTimers = timers;

    setWeaveState(stage, initialState);

    triggers.forEach(trigger => {
      const nextState = trigger.dataset.weaveTrigger || '0';

      if (supportsHover) {
        trigger.addEventListener('pointerenter', () => setWeaveState(stage, nextState, { userInitiated: true }), { passive: true });
      }

      trigger.addEventListener('focus', () => setWeaveState(stage, nextState, { userInitiated: true }), { passive: true });
      trigger.addEventListener('click', () => setWeaveState(stage, nextState, { userInitiated: true, pin: true }));
    });

    if (!prefersReducedMotion) {
      [1, 2, 3, 4].forEach((state, index) => {
        const timer = window.setTimeout(() => {
          if (stage.dataset.userControlled !== 'true' && stage.dataset.pinned !== 'true') {
            setWeaveState(stage, state);
          }
        }, 1400 + index * 2100);
        timers.push(timer);
      });
    }

    stage.addEventListener('pointerdown', () => {
      timers.forEach(timer => window.clearTimeout(timer));
      stage.dataset.userControlled = 'true';
    }, { passive: true });
  });
}

document.querySelectorAll('[data-reveal]').forEach(element => revealObserver.observe(element));
window.addEventListener('resize', resizeCanvas, { passive: true });
window.addEventListener('scroll', updateScroll, { passive: true });
resizeCanvas();
updateScroll();
revealVisibleElements();
initializeMemoryWeaves();
draw();
