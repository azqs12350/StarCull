/* StarCull · 认证：登录注册、安全问题、找回密码 */

/* ---------- security questions (20, bilingual) ---------- */

const SECURITY_QUESTIONS = [
  { id: 1,  zh: '你的出生地是哪里？',               en: 'Where were you born?' },
  { id: 2,  zh: '你母亲的娘家姓是什么？',           en: "What is your mother's maiden name?" },
  { id: 3,  zh: '你小学的名字是什么？',             en: 'What was the name of your elementary school?' },
  { id: 4,  zh: '你的第一只宠物叫什么名字？',       en: 'What was the name of your first pet?' },
  { id: 5,  zh: '你最喜欢的书是什么？',             en: 'What is your favorite book?' },
  { id: 6,  zh: '你父亲的名字是什么？',             en: "What is your father's first name?" },
  { id: 7,  zh: '你最喜欢的颜色是什么？',           en: 'What is your favorite color?' },
  { id: 8,  zh: '你的生日是几月几日？',             en: 'What is your birthday (month and day)?' },
  { id: 9,  zh: '你最要好的童年朋友叫什么？',       en: 'What was the name of your best childhood friend?' },
  { id: 10, zh: '你第一辆车的品牌和型号是什么？',   en: 'What was the make and model of your first car?' },
  { id: 11, zh: '你最喜欢的电影是什么？',           en: 'What is your favorite movie?' },
  { id: 12, zh: '你的第一份工作是什么？',           en: 'What was your first job?' },
  { id: 13, zh: '你最喜欢的食物是什么？',           en: 'What is your favorite food?' },
  { id: 14, zh: '你高中的吉祥物是什么？',           en: 'What was your high school mascot?' },
  { id: 15, zh: '你最喜欢的运动是什么？',           en: 'What is your favorite sport?' },
  { id: 16, zh: '你祖母的名字是什么？',             en: "What was your grandmother's first name?" },
  { id: 17, zh: '你最喜欢的歌曲是什么？',           en: 'What is your favorite song?' },
  { id: 18, zh: '你第一次坐飞机去的是哪里？',       en: 'Where did you go on your first airplane flight?' },
  { id: 19, zh: '你最喜欢的动物是什么？',           en: 'What is your favorite animal?' },
  { id: 20, zh: '你梦想中的度假目的地是哪里？',     en: 'What is your dream vacation destination?' }
];

// Return the question text for the current language (zh uses zh, en/es use en).
function questionText(q) {
  return currentLang === 'zh' ? q.zh : q.en;
}

// Populate a <select> with the 20 security questions.
function populateQuestionSelect(select, placeholderKey) {
  if (!select) return;
  const placeholder = placeholderKey ? t(placeholderKey) : '';
  select.innerHTML = `<option value="">${escapeHtml(placeholder)}</option>` +
    SECURITY_QUESTIONS.map((q) => `<option value="${escapeHtml(questionText(q))}">${escapeHtml(questionText(q))}</option>`).join('');
}

function setAuthMode(mode) {
  const prev = state.authMode;
  state.authMode = mode;
  $$('.switch-btn').forEach((btn) => {
    const on = btn.dataset.mode === mode;
    btn.classList.toggle('is-on', on);
    btn.setAttribute('aria-selected', String(on));
  });
  const isRegister = mode === 'register';
  els.registerSecurity.hidden = !isRegister;
  els.forgotWrap.hidden = isRegister;
  if (isRegister) {
    els.authHint.textContent = t('auth.hintRegister');
    els.authSubmit.textContent = t('auth.submitRegister');
    els.password.autocomplete = 'new-password';
    // Only wipe the answer when actually switching into register mode, so a
    // failed submit (which re-applies the mode) keeps what the user typed.
    if (prev !== 'register') els.securityAnswer.value = '';
  } else {
    els.authHint.textContent = t('auth.hintLogin');
    els.authSubmit.textContent = t('auth.submitLogin');
    els.password.autocomplete = 'current-password';
  }
  els.authError.textContent = '';
}

function showAuth() {
  state.user = null;
  els.app.hidden = true;
  els.auth.hidden = false;
  els.authError.textContent = '';
  els.password.value = '';
  setAuthMode('login');
  els.username.focus({ preventScroll: true });
}

async function submitAuth(event) {
  event.preventDefault();
  const username = els.username.value.trim();
  const password = els.password.value;
  if (!username || !password) {
    els.authError.textContent = t('error.authEmpty');
    return;
  }
  els.authError.textContent = '';
  els.authSubmit.disabled = true;
  els.authSubmit.textContent = 'One moment…';

  const isRegister = state.authMode === 'register';
  const body = { username, password };
  if (isRegister) {
    const sq = els.securityQuestion.value;
    const sa = els.securityAnswer.value.trim();
    if (!sq || !sa) {
      els.authError.textContent = t('error.sqRequired');
      els.authSubmit.disabled = false;
      return;
    }
    body.securityQuestion = sq;
    body.securityAnswer = sa;
  }

  try {
    const data = await api(isRegister ? '/api/register' : '/api/login', {
      method: 'POST',
      body
    });
    applySession(data);
    enterApp();
    els.authForm.reset();
    els.securityQuestion.value = '';
    if (data.dailyBonus > 0) {
      setTimeout(() => showBonusPopup(data.dailyBonus), 300);
    }
  } catch (error) {
    setAuthMode(state.authMode);
    els.authError.textContent = error.message;
  } finally {
    els.authSubmit.disabled = false;
  }
}

function applySession(data) {
  state.user = data.user;
  state.products = data.products || [];
  state.draw = data.draw || null;
  state.points = data.user ? (data.user.points || 0) : 0;
  state.category = defaultCategory();
  state.page = 1;
}

function updatePoints(n) {
  state.points = n;
  if (els.pointsBadge) {
    els.pointsValue.textContent = String(n);
    els.pointsBadge.hidden = !state.user || state.user.role === 'admin';
    els.pointsBadge.setAttribute('title', t('points.balance', { n }));
  }
}

async function signOut() {
  try { await api('/api/logout', { method: 'POST' }); } catch { /* ignore */ }
  state.products = [];
  state.draw = null;
  closeLightbox();
  closeDraw();
  closeSecurityQuestionSetup();
  if (state._msgPolling) { clearInterval(state._msgPolling); state._msgPolling = null; }
  setView('collection');
  showAuth();
}

/* ---------- security question setup (forced) ---------- */

function openSecurityQuestionSetup() {
  const modal = $('#sq-setup-modal');
  if (!modal) return;
  populateQuestionSelect($('#sq-setup-question'), 'auth.selectQuestion');
  $('#sq-setup-question').value = '';
  $('#sq-setup-answer').value = '';
  $('#sq-setup-error').textContent = '';
  modal.hidden = false;
  document.body.style.overflow = 'hidden';
  setTimeout(() => $('#sq-setup-question').focus(), 50);
}

function closeSecurityQuestionSetup() {
  const modal = $('#sq-setup-modal');
  if (modal) modal.hidden = true;
  document.body.style.overflow = '';
}

async function submitSecurityQuestionSetup(event) {
  event.preventDefault();
  const question = $('#sq-setup-question').value;
  const answer = $('#sq-setup-answer').value.trim();
  const err = $('#sq-setup-error');
  if (!question || !answer) {
    err.textContent = t('error.sqRequired');
    return;
  }
  err.textContent = '';
  try {
    const data = await api('/api/user/security-question', {
      method: 'PUT',
      body: { securityQuestion: question, securityAnswer: answer }
    });
    if (data.user) state.user.hasSecurityQuestion = data.user.hasSecurityQuestion;
    closeSecurityQuestionSetup();
    toast(t('studio.accountSaved'));
  } catch (error) {
    err.textContent = error.message;
  }
}

/* ---------- password recovery ---------- */

let recoverUsername = '';

function openRecoverModal() {
  recoverUsername = '';
  $('#recover-username').value = '';
  $('#recover-answer').value = '';
  $('#recover-new-password').value = '';
  $('#recover-question-text').textContent = '';
  $('#recover-error').textContent = '';
  $('#recover-error2').textContent = '';
  $('#recover-step1').hidden = false;
  $('#recover-step2').hidden = true;
  $('#recover-step3').hidden = true;
  $('#recover-modal').hidden = false;
  document.body.style.overflow = 'hidden';
  setTimeout(() => $('#recover-username').focus(), 50);
}

function closeRecoverModal() {
  $('#recover-modal').hidden = true;
  document.body.style.overflow = '';
}

async function submitRecoverStep1(event) {
  event.preventDefault();
  const username = $('#recover-username').value.trim();
  const err = $('#recover-error');
  if (!username) {
    err.textContent = t('error.authEmpty');
    return;
  }
  err.textContent = '';
  try {
    const data = await api(`/api/recover/question?username=${encodeURIComponent(username)}`);
    recoverUsername = username;
    $('#recover-question-text').textContent = data.question;
    $('#recover-step1').hidden = true;
    $('#recover-step2').hidden = false;
    $('#recover-answer').focus();
  } catch (error) {
    err.textContent = error.message;
  }
}

async function submitRecoverStep2(event) {
  event.preventDefault();
  const answer = $('#recover-answer').value.trim();
  const newPassword = $('#recover-new-password').value;
  const err = $('#recover-error2');
  if (!answer || !newPassword) {
    err.textContent = t('error.authEmpty');
    return;
  }
  err.textContent = '';
  try {
    await api('/api/recover/password', {
      method: 'POST',
      body: { username: recoverUsername, answer, newPassword }
    });
    $('#recover-step2').hidden = true;
    $('#recover-step3').hidden = false;
  } catch (error) {
    err.textContent = error.message;
  }
}

function finishRecover() {
  closeRecoverModal();
  setAuthMode('login');
  els.username.value = recoverUsername;
  els.password.focus();
}

/* ---------- collection ---------- */

function enterApp() {
  els.auth.hidden = true;
  els.app.hidden = false;
  els.who.textContent = state.user.username;
  els.who.hidden = state.user.role === 'admin';
  updatePoints(state.points);
  els.studioBtn.hidden = state.user.role !== 'admin';
  els.prizesBtn.hidden = state.user.role === 'admin';
  const isAdmin = state.user.role === 'admin';
  // 铃铛：管理员和普通用户都显示；文字留言按钮只给普通用户（管理员用工作室 tab）
  els.msgBell.hidden = false;
  els.messagesBtn.hidden = isAdmin;
  updateMessagesBadge();
  startMessagesPolling();
  const kicker = document.querySelector('#collection-view .kicker');
  if (kicker) kicker.innerHTML = t('intro.kicker', { season: seasonLabel() });
  renderCollection();

  // Force users who registered before the security-question feature (or whose
  // admin-created account has none) to set one before they can use the app.
  if (!state.user.hasSecurityQuestion) {
    openSecurityQuestionSetup();
  }
}

function showBonusPopup(amount) {
  if (!amount) return;
  els.bonusAmount.textContent = '+' + amount;
  els.bonusModal.hidden = false;
}

function hideBonusPopup() {
  els.bonusModal.hidden = true;
}
