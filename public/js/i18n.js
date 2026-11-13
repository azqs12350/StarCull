/* StarCull · 国际化运行时：取值、插值与整页应用 */

function resolveI18n(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);
}
function t(key, vars = {}) {
  let str = resolveI18n(I18N[currentLang], key);
  if (str == null) str = resolveI18n(I18N.en, key);
  if (str == null) return key;
  return String(str).replace(/\{(\w+)\}/g, (_, k) => (vars[k] != null ? vars[k] : ''));
}
function tp(key, n, vars = {}) {
  return t(`${key}.${n === 1 ? 'one' : 'other'}`, { ...vars, n });
}
function translateServerError(message) {
  const map = {
    'Enter both an account name and a password.': 'error.authEmpty',
    'Account or password is incorrect.': 'error.invalidUser',
    'That account name is already taken.': 'error.userTaken',
    'Use 2–24 letters, numbers, dots or dashes.': 'error.credRule',
    'Password needs at least 6 characters.': 'error.credRule',
    'Please sign in first.': 'error.generic',
    'Studio access only.': 'error.generic',
    'An account has already been registered from this network.': 'error.ipTaken',
    'Account not found.': 'error.acctNotFound',
    'You cannot remove your own account.': 'error.selfRemove',
    'You cannot change your own role.': 'error.selfRole',
    'Points must be zero or more.': 'error.pointsRule',
    'Pick a security question.': 'error.sqRequired',
    'Answer the security question.': 'error.sqRequired',
    'The security answer is incorrect.': 'error.answerWrong',
    'This account has no security question set. Please contact the studio.': 'error.noSq'
  };
  return map[message] ? t(map[message]) : message;
}

function applyLanguage() {
  document.documentElement.lang = currentLang;
  localStorage.setItem('sc_lang', currentLang);

  $$('[data-i18n]').forEach((el) => {
    const key = el.dataset.i18n;
    let vars = {};
    if (el.dataset.i18nVars) {
      try { vars = JSON.parse(el.dataset.i18nVars); } catch { /* ignore */ }
    }
    el.innerHTML = t(key, vars);
  });
  $$('[data-i18n-ph]').forEach((el) => {
    el.placeholder = t(el.dataset.i18nPh);
  });
  $$('[data-i18n-aria]').forEach((el) => {
    el.setAttribute('aria-label', t(el.dataset.i18nAria));
  });

  $$('.lang-btn').forEach((btn) => {
    btn.classList.toggle('is-on', btn.dataset.lang === currentLang);
  });

  // Repopulate security-question selects with the current language's text.
  // Keep whatever the user had already picked (options share the same order).
  [els.securityQuestion, $('#sq-setup-question'), $('#account-add-question')].forEach((sel) => {
    if (!sel) return;
    const idx = sel.selectedIndex;
    const key = sel.id === 'account-add-question' ? 'studio.accountQuestionPh' : 'auth.selectQuestion';
    populateQuestionSelect(sel, key);
    if (idx > 0) sel.selectedIndex = idx;
  });

  // re-render dynamic parts
  if (state.user) {
    if (state.view === 'collection') {
      const kicker = document.querySelector('#collection-view .kicker');
      if (kicker) kicker.innerHTML = t('intro.kicker', { season: seasonLabel() });
      renderCollection();
    }
    if (state.view === 'studio') {
      els.studioBtn.textContent = t('nav.collection');
      loadStudio();
    }
  }
  if (!els.auth.hidden) setAuthMode(state.authMode);
}

function setLang(lang) {
  if (!LANGS.includes(lang)) return;
  currentLang = lang;
  applyLanguage();
}
