import { story } from './story-data.js';
import { setupHeroMotion } from './hero-motion.js';
import { setupJourneyIntro } from './journey-motion.js';
import { initScrollMotion } from './scroll-motion.js';
import { initFinaleMotion } from './finale-motion.js';
import { renderSourceMarkdown } from './source-markdown.js';
import { initialLanguage, languageStorageKey, normalizeLanguage, translatePage } from './i18n.js';

let language;
try { language = initialLanguage(window.localStorage); } catch { language = 'en'; }
let conversation = 'team';
let playing = false;
let scrollControlled = false;
let finaleProgress = 0;
let playback;
let activeSource = null;
let sourceTrigger = null;
const dialog = document.querySelector('#source-dialog');
const messages = document.querySelector('#discussion-messages');
const bring = document.querySelector('#bring-izge');

function messageNode(message) {
  const row = document.createElement('article');
  row.className = `message${message.role === 'izge' ? ' izge-message' : ''}`;
  const avatar = document.createElement('span');
  avatar.className = `avatar${message.role === 'izge' ? ' izge' : ''}`;
  avatar.setAttribute('aria-hidden', 'true');
  if (message.role === 'izge') {
    const logo = document.createElement('span');
    logo.className = 'izge-logo';
    avatar.append(logo);
  } else avatar.textContent = message.name[0];
  const content = document.createElement('div');
  const name = document.createElement('strong');
  name.className = 'message-name';
  name.textContent = message.name;
  const body = document.createElement('p');
  message.body.split(/(@izge)/gi).forEach(part => {
    if (part.toLowerCase() === '@izge') {
      const mention = document.createElement('mark');
      mention.textContent = part;
      body.append(mention);
    } else body.append(document.createTextNode(part));
  });
  content.append(name, body);
  row.append(avatar, content);
  return row;
}
function renderConversation() {
  playback?.destroy();
  playback = null;
  document.querySelectorAll('[data-conversation]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.conversation === conversation)));
  bring.closest('.team-composer').hidden = conversation === 'private' || playing;
  if (conversation === 'team' && playing) playback = setupHeroMotion({ container: messages, getLanguage: () => language, scrollControlled });
  else messages.replaceChildren(...(conversation === 'private' ? story[language].private : []).map(messageNode));
  bring.closest('.team-composer').dataset.sender = language === 'tr' ? 'Siz' : 'You';
}
function renderSource() {
  const source = story[language].sources.find(({ id }) => id === activeSource);
  if (!source) return;
  document.querySelector('#source-title').textContent = source.title;
  document.querySelector('#source-filename').textContent = source.filename;
  document.querySelector('#source-body').replaceChildren(renderSourceMarkdown(source.body, document));
  document.querySelector('#source-body').scrollTop = 0;
}
document.addEventListener('click', event => {
  const target = event.target.closest('[data-source]');
  if (!target || !story[language].sources.some(source => source.id === target.dataset.source)) return;
  activeSource = target.dataset.source;
  sourceTrigger = target;
  renderSource();
  if (!dialog.open) dialog.showModal();
  document.querySelector('#close-source').focus();
});
document.querySelector('#close-source').addEventListener('click', () => dialog.close());
dialog.addEventListener('close', () => { sourceTrigger?.focus({ preventScroll: true }); activeSource = null; });
dialog.addEventListener('click', event => {
  if (event.target !== dialog) return;
  const bounds = dialog.getBoundingClientRect();
  if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close();
});
document.querySelectorAll('[data-conversation]').forEach(button => button.addEventListener('click', () => {
  conversation = button.dataset.conversation;
  renderConversation();
  document.dispatchEvent(new Event('izge:conversation'));
}));
bring.addEventListener('click', () => {
  scrollControlled = false;
  playing = true;
  renderConversation();
  document.dispatchEvent(new Event('izge:conversation'));
  messages.querySelector('.hero-motion__control')?.focus({ preventScroll: true });
});
function render() {
  translatePage(language);
  renderConversation();
  if (activeSource) renderSource();
  document.dispatchEvent(new Event('izge:language'));
}
document.querySelectorAll('[data-language]').forEach(button => button.addEventListener('click', () => {
  language = normalizeLanguage(button.dataset.language);
  try { window.localStorage.setItem(languageStorageKey, language); } catch { /* Language still changes when storage is unavailable. */ }
  render();
}));
render();
setupJourneyIntro(() => language);
initScrollMotion();
initFinaleMotion({ advance(progress, velocity) {
  if (progress < finaleProgress - .0001 && playing) scrollControlled = true;
  finaleProgress = progress;
  if (conversation !== 'team') return;
  if (progress < .12) {
    if (playing && scrollControlled) { playing = false; renderConversation(); }
  } else if (!playing) {
    scrollControlled = true;
    playing = true;
    renderConversation();
  }
  playback?.setScrollProgress(progress, velocity);
} });
