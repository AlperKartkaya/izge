export const languageStorageKey = 'izge.website.language';
export function normalizeLanguage(value) { return value === 'tr' ? 'tr' : 'en'; }
export function initialLanguage(storage) {
  try { return normalizeLanguage(storage.getItem(languageStorageKey)); }
  catch { return 'en'; }
}
export function translatePage(language, root = document) {
  root.documentElement.lang = language;
  root.querySelectorAll('[data-en][data-tr]').forEach((element) => { element.textContent = element.dataset[language]; });
  root.querySelectorAll('[data-label-en][data-label-tr]').forEach((element) => {
    element.setAttribute('aria-label', element.dataset[language === 'tr' ? 'labelTr' : 'labelEn']);
  });
  root.querySelectorAll('[data-language]').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.language === language)));
  root.title = 'İzge - Ekip arkadaşınız';
  root.querySelector('meta[name="description"]').content = language === 'tr'
    ? 'İzge şirket hafızasını, kanıtları ve konuşmaları birleştirir. Gözden kaçanı fark edin, sonraki adıma birlikte karar verin.'
    : 'Izge connects company memory, evidence and conversations so your team can spot what was missed and decide what comes next.';
}
