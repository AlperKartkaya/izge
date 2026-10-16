import { story } from './story-data.js';

const copy = {
  en: {
    title: 'Team conversation',
    thinking: ['Connecting the records…', 'Comparing contract, delivery and invoice…', 'Checking the commercial boundary…'],
    reaction: 'That would have slipped through. Nice catch, Izge.',
    congratulations: 'Great catch. I’ll review the delivery evidence and customer confirmation before approving any invoice attachment.',
    pause: 'Pause playback',
    resume: 'Resume playback',
    replay: 'Replay conversation',
    completeButton: 'Complete',
    paused: 'Playback paused',
    complete: 'Conversation complete',
  },
  tr: {
    title: 'Ekip konuşması',
    thinking: ['Kayıtlar birbirine bağlanıyor…', 'Sözleşme, teslim ve fatura karşılaştırılıyor…', 'Ticari karar sınırı kontrol ediliyor…'],
    reaction: 'Bu gözden kaçacaktı. İyi yakaladın İzge.',
    congratulations: 'Harika yakaladın. Herhangi bir fatura ekini onaylamadan önce teslim kanıtını ve müşteri teyidini inceleyeceğim.',
    pause: 'Oynatımı duraklat',
    resume: 'Oynatımı sürdür',
    replay: 'Konuşmayı yeniden oynat',
    completeButton: 'Tamamlandı',
    paused: 'Oynatım duraklatıldı',
    complete: 'Konuşma tamamlandı',
  },
};

export function buildHeroTimeline(language = 'en') {
  const locale = language === 'tr' ? 'tr' : 'en';
  const messages = story[locale].team;
  const answer = {
    ...messages[1],
    body: messages[1].body
      .replace(locale === 'tr' ? 'Temsili inceleme: ' : 'Illustrative review: ', '')
      .replace(/^./, (character) => character.toLocaleUpperCase(locale)),
  };

  return {
    language: locale,
    duration: 16_000,
    thinking: copy[locale].thinking,
    events: [
      { at: 0, type: 'message', id: 'question', message: { name: locale === 'tr' ? 'Siz' : 'You', role: 'self', body: locale === 'tr' ? '@izge Teslim kaydıyla faturayı karşılaştır' : '@izge Compare the delivery and invoice' } },
      { at: 1_800, type: 'thinking', phase: 0 },
      { at: 3_000, type: 'thinking', phase: 1 },
      { at: 4_200, type: 'thinking', phase: 2 },
      { at: 5_200, type: 'stream', id: 'answer', message: answer, duration: 7_000 / 1.5 },
      { at: 11_200, type: 'message', id: 'reaction', message: { name: 'Ece', role: 'person', body: copy[locale].reaction } },
      { at: 13_500, type: 'message', id: 'congratulations', message: { name: 'Selin', role: 'person', body: copy[locale].congratulations } },
    ],
  };
}

export function scrollStreamRate(velocity) {
  return 1 + Math.min(3, Math.abs(velocity) * .75);
}

export function scrollPlaybackTime(progress, timeline) {
  const stream = timeline.events.find(event => event.type === 'stream');
  const reaction = timeline.events.find(event => event.id === 'reaction');
  const answerEnd = stream.at + stream.duration;
  if (progress >= .83) return { floor: timeline.duration, ceiling: timeline.duration };
  if (progress >= .63) return { floor: reaction.at, ceiling: reaction.at };
  const reveal = Math.min(1, Math.max(0, (progress - .42) / .2));
  return { floor: reveal ? stream.at + stream.duration * reveal : 0, ceiling: answerEnd };
}

export function scrollRewindTime(progress, timeline) {
  const stream = timeline.events.find(event => event.type === 'stream');
  if (progress >= .83) return timeline.duration;
  if (progress >= .63) return timeline.events.find(event => event.id === 'reaction').at;
  if (progress >= .42) return stream.at + stream.duration * Math.min(1, (progress - .42) / .2);
  return stream.at * Math.max(0, (progress - .12) / .3);
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function appendMention(body, text) {
  text.split(/(@izge)/gi).forEach((part) => {
    if (part.toLowerCase() === '@izge') body.append(element('mark', 'izge-mention', part));
    else body.append(document.createTextNode(part));
  });
}

function createMessage(message, id) {
  const row = element('article', `message hero-motion__message${message.role === 'izge' ? ' izge-message' : message.role === 'self' ? ' self-message' : ''}`);
  row.dataset.motionMessage = id;
  const avatar = element('span', `avatar${message.role === 'izge' ? ' izge' : ''}`, message.role === 'izge' ? '' : message.name[0]);
  avatar.setAttribute('aria-hidden', 'true');
  if (message.role === 'izge') avatar.append(element('span', 'izge-logo'));
  const content = element('div');
  content.append(element('strong', 'message-name', message.name));
  const body = element('p');
  appendMention(body, message.body);
  content.append(body);
  row.append(avatar, content);
  return { row, body };
}

export function setupHeroMotion({ container, getLanguage = () => 'en', scrollControlled = false }) {
  if (!container) return { play() {}, pause() {}, resume() {}, setScrollProgress() {}, destroy() {} };

  const host = container.closest('.conversation-preview') || container;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let frame = 0;
  let running = false;
  let lastTick = 0;
  let scrollProgress = 0;
  let rewinding = false;
  let scrollVelocity = 0;
  let lastScroll = 0;
  let elapsed = 0;
  let timeline;
  let transcript;
  let root;
  let status;
  let toggle;
  let replay;
  let userPaused = false;
  let pageVisible = !document.hidden;
  let sceneVisible = true;
  let userScrolled = false;
  let programmaticScroll = false;
  const rendered = new Set();

  host.classList.add('hero-motion-host');

  function localeCopy() {
    return copy[timeline?.language || (getLanguage() === 'tr' ? 'tr' : 'en')];
  }

  function shouldRun() {
    return !rewinding && !userPaused && pageVisible && sceneVisible && elapsed < timeBounds().ceiling;
  }

  function timeBounds() {
    return scrollControlled ? scrollPlaybackTime(scrollProgress, timeline) : { floor: 0, ceiling: timeline.duration };
  }

  function updatePlaybackClass() {
    root?.classList.toggle('is-running', running);
    root?.classList.toggle('is-paused', userPaused);
    root?.classList.toggle('is-scrubbing', rewinding);
    root?.classList.toggle('is-complete', elapsed >= timeline?.duration);
  }

  function updateControls() {
    const labels = localeCopy();
    const complete = elapsed >= timeline.duration;
    toggle.textContent = complete ? labels.completeButton : userPaused ? labels.resume : labels.pause;
    toggle.disabled = complete;
    toggle.setAttribute('aria-pressed', String(userPaused));
    status.textContent = complete ? labels.complete : userPaused ? labels.paused : '';
  }

  function keepLatestVisible() {
    if (userScrolled || !transcript) return;
    programmaticScroll = true;
    transcript.scrollTop = transcript.scrollHeight;
    requestAnimationFrame(() => { programmaticScroll = false; });
  }

  function appendMessage(event) {
    const { row } = createMessage(event.message, event.id);
    transcript.append(row);
    rendered.add(event.id);
    keepLatestVisible();
  }

  function renderThinking(phase) {
    let row = transcript.querySelector('[data-motion-message="thinking"]');
    if (!row) {
      row = element('article', 'message izge-message hero-motion__message hero-motion__thinking');
      row.dataset.motionMessage = 'thinking';
      const avatar = element('span', 'avatar izge');
      avatar.setAttribute('aria-hidden', 'true');
      avatar.append(element('span', 'izge-logo'));
      const content = element('div');
      content.append(element('strong', 'message-name', 'Izge'));
      content.append(element('p', 'hero-motion__thinking-copy'));
      content.append(element('span', 'hero-motion__thinking-pulse'));
      row.append(avatar, content);
      transcript.append(row);
    }
    row.querySelector('.hero-motion__thinking-copy').textContent = timeline.thinking[phase];
    rendered.add(`thinking-${phase}`);
    keepLatestVisible();
  }

  function renderStream(event, now) {
    transcript.querySelector('[data-motion-message="thinking"]')?.remove();
    let row = transcript.querySelector(`[data-motion-message="${event.id}"]`);
    if (!row) {
      const created = createMessage({ ...event.message, body: '' }, event.id);
      created.body.classList.add('hero-motion__stream');
      created.body.setAttribute('aria-label', event.message.body);
      transcript.append(created.row);
      row = created.row;
      keepLatestVisible();
    }
    const body = row.querySelector('.hero-motion__stream');
    const progress = Math.min(1, Math.max(0, (now - event.at) / event.duration));
    const length = Math.ceil(event.message.body.length * progress);
    const next = event.message.body.slice(0, length);
    if (body.textContent !== next) {
      body.textContent = next;
      keepLatestVisible();
    }
    if (progress === 1) {
      rendered.add(event.id);
      if (!row.querySelector('.message-citations')) {
        const citations = element('div', 'message-citations');
        const labels = timeline.language === 'tr' ? ['Sözleşme', 'Teslim kaydı', 'Fatura'] : ['Contract', 'Delivery record', 'Invoice'];
        ['contract', 'delivery', 'invoice'].forEach((id, index) => {
          const button = element('button', '', labels[index]);
          button.type = 'button';
          button.dataset.source = id;
          citations.append(button);
        });
        row.lastElementChild.append(citations);
        keepLatestVisible();
      }
    }
    if (progress < 1) { row.querySelector('.message-citations')?.remove(); rendered.delete(event.id); }
    body.classList.toggle('is-complete', progress === 1);
  }

  function renderAt(now) {
    if (rewinding) {
      for (const event of timeline.events) {
        if (event.type === 'thinking') rendered.delete(`thinking-${event.phase}`);
        else if (now < event.at) {
          transcript.querySelector(`[data-motion-message="${event.id}"]`)?.remove();
          rendered.delete(event.id);
        }
      }
      if (now < 1800) transcript.querySelector('[data-motion-message="thinking"]')?.remove();
    }
    for (const event of timeline.events) {
      if (now < event.at) continue;
      if (event.type === 'message' && !rendered.has(event.id)) appendMessage(event);
      if (event.type === 'thinking' && !rendered.has(`thinking-${event.phase}`)) renderThinking(event.phase);
      if (event.type === 'stream') renderStream(event, now);
    }
    if (now >= timeline.duration) {
      elapsed = timeline.duration;
      running = false;
      updateControls();
    }
    updateControls();
    updatePlaybackClass();
  }

  function tick(timestamp) {
    const stream = timeline.events.find(event => event.type === 'stream');
    const streaming = elapsed >= stream.at && elapsed < stream.at + stream.duration;
    const rate = streaming && timestamp - lastScroll < 180 ? scrollStreamRate(scrollVelocity) : 1;
    const bounds = timeBounds();
    elapsed = Math.min(bounds.ceiling, Math.max(bounds.floor, elapsed + (timestamp - lastTick) * rate));
    lastTick = timestamp;
    renderAt(elapsed);
    if (shouldRun()) frame = requestAnimationFrame(tick);
    else { running = false; updatePlaybackClass(); }
  }

  function startClock() {
    if (!shouldRun() || running) return;
    lastTick = performance.now();
    running = true;
    updatePlaybackClass();
    frame = requestAnimationFrame(tick);
  }

  function stopClock() {
    running = false;
    cancelAnimationFrame(frame);
    updatePlaybackClass();
  }

  function renderComplete() {
    elapsed = timeline.duration;
    renderAt(elapsed);
    updateControls();
  }

  function mount() {
    const labels = localeCopy();
    root = element('section', 'hero-motion');
    root.setAttribute('aria-label', labels.title);
    root.dataset.scrollControlled = String(scrollControlled);
    transcript = element('div', 'hero-motion__transcript');
    transcript.setAttribute('aria-live', 'off');
    transcript.setAttribute('aria-label', labels.title);
    transcript.tabIndex = 0;
    const controls = element('div', 'hero-motion__controls');
    toggle = element('button', 'hero-motion__control', labels.pause);
    toggle.type = 'button';
    toggle.addEventListener('click', () => userPaused ? resume() : pause());
    replay = element('button', 'hero-motion__control', labels.replay);
    replay.type = 'button';
    replay.addEventListener('click', () => { scrollControlled = false; play(true); });
    status = element('span', 'hero-motion__status');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    controls.append(toggle, replay, status);
    root.append(transcript, controls);
    container.replaceChildren(root);
    transcript.addEventListener('focusin', pause);
    transcript.addEventListener('wheel', () => { userScrolled = true; }, { passive: true });
    transcript.addEventListener('touchstart', () => { userScrolled = true; }, { passive: true });
    transcript.addEventListener('scroll', () => { if (!programmaticScroll && transcript.scrollTop + transcript.clientHeight < transcript.scrollHeight - 8) userScrolled = true; }, { passive: true });
  }

  function play(focusReplay = false) {
    cancelAnimationFrame(frame);
    running = false;
    timeline = buildHeroTimeline(getLanguage());
    elapsed = 0;
    rewinding = false;
    userPaused = false;
    userScrolled = false;
    rendered.clear();
    mount();
    if (reduceMotion.matches) renderComplete();
    else { renderAt(0); startClock(); }
    if (focusReplay) replay.focus({ preventScroll: true });
  }

  function pause() {
    if (userPaused || elapsed >= timeline.duration) return;
    stopClock();
    userPaused = true;
    updateControls();
    updatePlaybackClass();
  }

  function resume() {
    if (!userPaused || elapsed >= timeline.duration) return;
    userPaused = false;
    updateControls();
    startClock();
  }

  function handleVisibility() {
    pageVisible = !document.hidden;
    if (pageVisible) startClock();
    else stopClock();
  }

  function handleReducedMotion(event) {
    if (!event.matches) return;
    stopClock();
    renderComplete();
  }

  document.addEventListener('visibilitychange', handleVisibility);
  reduceMotion.addEventListener('change', handleReducedMotion);
  const observer = 'IntersectionObserver' in window ? new IntersectionObserver(([entry]) => {
    sceneVisible = entry.isIntersecting;
    if (sceneVisible) startClock();
    else stopClock();
  }, { threshold: 0.1 }) : null;
  observer?.observe(container);
  play();

  return {
    play,
    pause,
    resume,
    setScrollProgress(progress, velocity = 0) {
      const backwards = progress < scrollProgress - .0001;
      if (progress > scrollProgress + .0001) rewinding = false;
      scrollProgress = progress;
      scrollVelocity = velocity;
      lastScroll = performance.now();
      if (backwards) { scrollControlled = true; root.dataset.scrollControlled = 'true'; }
      if (!scrollControlled || userPaused || reduceMotion.matches) return;
      if (backwards) {
        rewinding = true;
        stopClock();
        elapsed = Math.min(elapsed, scrollRewindTime(progress, timeline));
      } else if (!rewinding) elapsed = Math.max(elapsed, timeBounds().floor);
      renderAt(elapsed);
      startClock();
    },
    destroy() {
      cancelAnimationFrame(frame);
      observer?.disconnect();
      document.removeEventListener('visibilitychange', handleVisibility);
      reduceMotion.removeEventListener('change', handleReducedMotion);
      host.classList.remove('hero-motion-host');
    },
  };
}
