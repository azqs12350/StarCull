/* StarCull · 通用能力：请求、转义、本地化、提示 */

/* ---------- helpers ---------- */

async function api(path, options = {}) {
  const opts = { ...options };
  if (opts.body && !(opts.body instanceof FormData)) {
    opts.headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
    opts.body = JSON.stringify(opts.body);
  }
  const res = await fetch(path, opts);
  let data = {};
  try { data = await res.json(); } catch { /* no body */ }
  if (!res.ok) throw new Error(translateServerError(data.error || 'Something went wrong.'));
  return data;
}

/* ---------- translation ---------- */

function containsChinese(text) {
  return /[\u4e00-\u9fa5]/.test(String(text || ''));
}

async function translateToEnglish(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed || !containsChinese(trimmed)) return text;
  try {
    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(trimmed)}&langpair=zh-CN|en`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('Translate API error');
    const data = await res.json();
    const translated = (data.responseData && data.responseData.translatedText) || '';
    return translated.trim() || text;
  } catch {
    return text;
  }
}

async function handleTranslateClick(btn) {
  const fromName = btn.dataset.from;
  const toName = btn.dataset.to;
  const form = btn.closest('form');
  if (!form || !form[fromName] || !form[toName]) return;
  const fromInput = form[fromName];
  const toInput = form[toName];
  const original = fromInput.value.trim();
  if (!original) { toast(t('studio.transEmpty')); return; }
  if (!containsChinese(original)) { toast(t('studio.transNoCn')); return; }

  btn.disabled = true;
  btn.classList.add('translating');
  btn.textContent = '…';

  const translated = await translateToEnglish(original);

  btn.disabled = false;
  btn.classList.remove('translating');
  btn.textContent = '译';

  if (translated && translated !== original) {
    toInput.value = translated;
    toast(t('studio.transDone'));
  } else {
    toast(t('studio.transFail'));
  }
}

function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ---------- bilingual helpers ---------- */

// Get the best available localized field from a product.
// Falls back gracefully if the preferred language is empty.
function getLocalized(product, field, lang) {
  const l = lang || currentLang || 'en';
  const suffix = l === 'zh' ? 'Zh' : 'En';
  const oppositeSuffix = l === 'zh' ? 'En' : 'Zh';
  const primary = product[field + suffix] || '';
  if (primary) return primary;
  const fallback = product[field + oppositeSuffix] || '';
  if (fallback) return fallback;
  return product[field] || '';
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

function toast(message) {
  els.toast.textContent = message;
  els.toast.hidden = false;
  requestAnimationFrame(() => els.toast.classList.add('show'));
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => {
    els.toast.classList.remove('show');
    setTimeout(() => { els.toast.hidden = true; }, 350);
  }, 2600);
}

function productById(id) {
  return state.products.find((p) => p.id === id);
}

function starredProducts() {
  return state.products.filter((p) => p.starred);
}

function folderCounts(products = state.products) {
  // Group products by their series pair to avoid duplicate pills
  // (a single series has both a Chinese and English label)
  const groups = new Map(); // key = canonical series name, value = { zh, en, count }
  products.forEach((p) => {
    const zh = p.seriesZh || '';
    const en = p.seriesEn || '';
    const legacy = p.series || '';
    // Display label: prefer Chinese, fall back to English
    const display = zh || en || legacy;
    if (!display) return;
    if (!groups.has(display)) {
      groups.set(display, { zh, en, legacy, count: 0 });
    }
    groups.get(display).count += 1;
  });
  return [...groups.entries()]
    .map(([name, info]) => ({ name, ...info }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function defaultCategory() {
  const folders = folderCounts();
  return folders.length ? folders[0].name : '';
}

function filteredProducts() {
  const base = state.starredOnly ? starredProducts() : state.products;
  if (!state.category) return base;
  const pair = resolveCategoryPair(state.category);
  return base.filter((p) => {
    if (pair.zh && p.seriesZh === pair.zh) return true;
    if (pair.en && p.seriesEn === pair.en) return true;
    if (p.series === state.category) return true;
    if (p.series === pair.zh || p.series === pair.en) return true;
    return false;
  });
}

// Resolve a display category name to its bilingual pair for filtering.
// Pass an explicit products array when the working set differs from state.products.
function resolveCategoryPair(categoryName, products = state.products) {
  const folders = folderCounts(products);
  for (const f of folders) {
    if (f.name === categoryName) return { zh: f.zh, en: f.en };
    // Also match by raw zh/en in case state.category was set to a different variant
    if (f.zh && f.zh === categoryName) return { zh: f.zh, en: f.en };
    if (f.en && f.en === categoryName) return { zh: f.zh, en: f.en };
  }
  return { zh: categoryName, en: categoryName };
}

function pageCount() {
  return Math.max(1, Math.ceil(filteredProducts().length / pageSize()));
}

function pageSize() {
  return PAGE_SIZE;
}

function seasonLabel() {
  const now = new Date();
  const month = now.getMonth();
  const seasons = ['winter', 'winter', 'spring', 'spring', 'spring', 'summer', 'summer', 'summer', 'autumn', 'autumn', 'autumn', 'winter'];
  return `${t('season.' + seasons[month])} ${now.getFullYear()}`;
}

const STAR_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.4l2.55 5.6 6.05.68-4.5 4.1 1.22 6.02L12 16.75 6.68 19.8l1.22-6.02-4.5-4.1 6.05-.68z" /></svg>';
const LIKE_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 10h3v11H2zM21 10a2 2 0 0 0-2-2h-5.6l.9-4.3a1.6 1.6 0 0 0-3-.8L7.7 9.4A2 2 0 0 0 7 11v8a2 2 0 0 0 2 2h9.4a2 2 0 0 0 1.95-1.6l1.3-6A2 2 0 0 0 21 10z" /></svg>';
const DISLIKE_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M22 14h-3V3h3zM3 14a2 2 0 0 0 2 2h5.6l-.9 4.3a1.6 1.6 0 0 0 3 .8l5.6-6.5A2 2 0 0 0 17 13V5a2 2 0 0 0-2-2H5.6A2 2 0 0 0 3.65 4.6l-1.3 6A2 2 0 0 0 3 14z" /></svg>';

/* ---------- auth ---------- */
