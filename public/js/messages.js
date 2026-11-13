/* StarCull · 留言模块：用户面板 + 铃铛徽章（管理员/普通用户都有，但数据源不同） */

/* ---------- 用户：打开消息面板 ---------- */

async function openMessages() {
  // 管理员点击铃铛 → 进工作室并切到 messages tab
  if (state.user && state.user.role === 'admin') {
    openStudio();
    switchStudioTab('messages');
    openStudioMessages();
    return;
  }
  setView('messages');
  await loadMessages();
}

async function loadMessages() {
  try {
    const data = await api('/api/messages');
    renderMessages(data.thread || [], data.unreadByUser || 0);
    // 进入时自动把管理员消息标记为已读
    if (data.unreadByUser > 0) {
      api('/api/messages/read', { method: 'PUT' }).catch(() => {});
      updateMessagesBadge();
    }
  } catch (err) {
    toast(err.message);
  }
}

function renderMessages(thread, unread) {
  const box = $('#messages-thread');
  const input = $('#messages-input');
  box.innerHTML = '';
  if (!thread.length) {
    box.innerHTML = `<p class="list-empty">${t('messages.emptyHint')}</p>`;
  } else {
    thread.forEach((m) => {
      const row = document.createElement('div');
      row.className = 'msg-bubble' + (m.fromUser ? ' is-self' : ' is-admin');
      row.innerHTML = `
        <div class="msg-meta">${escapeHtml(m.fromName)} · ${new Date(m.createdAt).toLocaleString()}</div>
        <div class="msg-body">${escapeHtml(m.content)}</div>`;
      box.appendChild(row);
    });
    box.scrollTop = box.scrollHeight;
  }
  input.focus();
}

async function sendMessage() {
  const input = $('#messages-input');
  const content = (input.value || '').trim();
  if (!content) return;
  try {
    await api('/api/messages', { method: 'POST', body: { content } });
    input.value = '';
    await loadMessages();
  } catch (err) {
    toast(err.message);
  }
}

/* ---------- 铃铛未读徽章（管理员/用户通用，数据源按角色分叉） ---------- */

async function updateMessagesBadge() {
  if (!state.user) return;
  let unread = 0;
  try {
    if (state.user.role === 'admin') {
      // 管理员未读 = 所有用户发来但管理员没看的总和
      const r = await api('/api/studio/messages');
      unread = r.totalUnread || 0;
    } else {
      const r = await api('/api/messages');
      unread = r.unreadByUser || 0;
    }
  } catch (_) { return; }

  const bell = els.msgBell;
  const dot = els.bellDot;
  const btn = els.messagesBtn;

  const bellLabel = state.user.role === 'admin'
    ? (t('studio.messages') + (unread ? ` (${unread})` : ''))
    : (t('messages.title') + (unread ? ` (${unread})` : ''));

  if (unread > 0) {
    bell.classList.add('has-unread');
    bell.dataset.count = String(unread);
    dot.hidden = false;
    bell.setAttribute('aria-label', bellLabel);
    bell.setAttribute('title', bellLabel);
    // 工作室 tab 徽章（管理员）
    const studioTab = document.querySelector('[data-studio-tab="messages"]');
    if (studioTab) { studioTab.classList.add('has-badge'); studioTab.dataset.unread = String(unread); }
    // 普通用户的文字按钮
    if (btn && !btn.hidden) { btn.classList.add('has-badge'); btn.dataset.count = String(unread); }
  } else {
    bell.classList.remove('has-unread');
    delete bell.dataset.count;
    dot.hidden = true;
    bell.setAttribute('aria-label', bellLabel);
    bell.setAttribute('title', bellLabel);
    const studioTab = document.querySelector('[data-studio-tab="messages"]');
    if (studioTab) { studioTab.classList.remove('has-badge'); delete studioTab.dataset.unread; }
    if (btn) { btn.classList.remove('has-badge'); delete btn.dataset.count; }
  }
}

/* ---------- 轮询（登录态即启动，管理员也需要看新留言） ---------- */

function startMessagesPolling() {
  if (state._msgPolling) return;
  state._msgPolling = setInterval(() => {
    if (!state.user) return;
    updateMessagesBadge();
  }, 30_000); // 30s 一次
}
