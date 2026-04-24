const root = document.documentElement;
const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const canvas = document.querySelector('#memory-field');
const context = canvas?.getContext('2d');
const scenes = Array.from(document.querySelectorAll('.scene'));
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
    const distanceFromCenter = Math.abs(sceneProgress - 0.52);
    const presence = Math.min(1, Math.max(0.55, 1 - distanceFromCenter * 1.15));

    scene.style.setProperty('--scene-progress', sceneProgress.toFixed(4));
    scene.style.setProperty('--scene-presence', presence.toFixed(4));
    scene.classList.toggle('is-current-scene', sceneProgress > 0.18 && sceneProgress < 0.86);
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

document.querySelectorAll('[data-reveal]').forEach(element => revealObserver.observe(element));
window.addEventListener('resize', resizeCanvas, { passive: true });
window.addEventListener('scroll', updateScroll, { passive: true });
resizeCanvas();
updateScroll();
draw();
