/* StarCull · 后台：产品、账号、设置与记录 */

/* ---------- 常量：快递平台 ---------- */
// 与后端 draws.js 的 COURIER_PLATFORMS 保持同步
const STUDIO_COURIER_PLATFORMS = [
  { code: 'SF',    zh: '顺丰速运',      en: 'SF Express',      es: 'SF Express' },
  { code: 'YTO',   zh: '圆通速递',      en: 'YTO Express',     es: 'YTO Express' },
  { code: 'ZTO',   zh: '中通快递',      en: 'ZTO Express',     es: 'ZTO Express' },
  { code: 'STO',   zh: '申通快递',      en: 'STO Express',     es: 'STO Express' },
  { code: 'YD',    zh: '韵达快递',      en: 'Yunda',           es: 'Yunda' },
  { code: 'JD',    zh: '京东物流',      en: 'JD Logistics',    es: 'JD Logistics' },
  { code: 'EMS',   zh: '中国邮政EMS',   en: 'EMS / China Post', es: 'EMS / Correo de China' },
  { code: 'DHL',   zh: 'DHL',           en: 'DHL',             es: 'DHL' },
  { code: 'FEDEX', zh: 'FedEx',         en: 'FedEx',           es: 'FedEx' },
  { code: 'UPS',   zh: 'UPS',           en: 'UPS',             es: 'UPS' },
  { code: 'OTHER', zh: '其他',           en: 'Other',           es: 'Otro' }
];

function courierName(code) {
  if (!code) return '';
  const hit = STUDIO_COURIER_PLATFORMS.find((c) => c.code === code);
  return hit ? hit[state.lang] || hit.en : code;
}

/* ---------- studio draw row ---------- */

function drawStatusLabel(status) {
  // 兼容旧数据里的 confirmed（已由后端 bootstrap 迁移为 preparing，
  // 但此处再兜一次，防止后端缓存或漏迁移）
  if (status === 'confirmed') status = 'preparing';
  switch (status) {
    case 'preparing': return t('studio.statusPreparing');
    case 'shipped':   return t('studio.statusShipped');
    case 'done':      return t('studio.statusDone');
    default:          return t('studio.statusNoAddress');
  }
}

function drawStatusClass(status) {
  if (status === 'confirmed') status = 'preparing';
  switch (status) {
    case 'preparing': return 'is-preparing';
    case 'shipped':   return 'is-shipped';
    case 'done':      return 'is-done';
    default:          return 'is-no-address';
  }
}

function renderStudioDrawRow(draw) {
  const row = document.createElement('div');
  row.className = 'draw-row';
  row.dataset.drawId = draw.id;
  const isFramed = draw.prizeType === 'framed';
  const typeLabel = isFramed ? t('draw.typeFramed') : t('draw.typeCanvas');
  const statusClass = drawStatusClass(draw.status);
  const statusLabel = drawStatusLabel(draw.status);

  // 状态徽章
  const statusBadge = `<span class="status-badge ${statusClass}">${escapeHtml(statusLabel)}</span>`;

  // 管理操作按钮
  let adminActions = '';
  if (draw.status === 'preparing' && draw.shipping) {
    adminActions = `<button class="icon-btn admin-ship" data-ship="${draw.id}">${t('studio.btnShip')}</button>`;
  } else if (draw.status === 'shipped') {
    adminActions = `<button class="icon-btn admin-complete" data-complete="${draw.id}">${t('studio.btnComplete')}</button>
                    <button class="icon-btn admin-unship" data-unship="${draw.id}">${t('studio.btnUnship')}</button>`;
  } else if (draw.status === 'done') {
    adminActions = `<span class="muted">—</span>`;
  } else {
    adminActions = `<span class="muted">${t('studio.noAddressYet')}</span>`;
  }

  // 收货详情面板：默认收起，点按钮才展开（哪怕有地址）
  const shippingBlock = draw.shipping
    ? renderStudioShippingBlock(draw, false)
    : `<div class="draw-shipping-details is-empty">${t('studio.shippingNotSubmitted')}</div>`;

  row.innerHTML = `
    <img src="${escapeHtml(draw.image)}" alt="" />
    <div>
      <div class="name">${escapeHtml(getLocalized(draw, 'title'))}</div>
      <div class="meta">${escapeHtml(draw.username)} · ${new Date(draw.createdAt).toLocaleDateString()}</div>
    </div>
    <div class="code-txt">${escapeHtml(draw.code)}</div>
    <span class="prize-badge ${isFramed ? 'is-framed' : 'is-canvas'}">${escapeHtml(typeLabel)}</span>
    ${statusBadge}
    <div class="admin-actions">${adminActions}</div>
    <button class="icon-btn draw-remove" data-remove-draw="${draw.id}" data-name="${escapeHtml(draw.username)}" data-code="${escapeHtml(draw.code)}" title="${t('studio.remove')}">×</button>
    ${shippingBlock}`;
  return row;
}

function renderStudioShippingBlock(draw, defaultOpen) {
  const s = draw.shipping || {};
  const courierDisplay = s.courierPlatform
    ? `<br />${t('studio.courier')}：${escapeHtml(s.courierPlatform === 'OTHER' ? (s.courierCustom || 'Other') : courierName(s.courierPlatform))}${s.trackingNumber ? ` · ${t('studio.tracking')}：${escapeHtml(s.trackingNumber)}` : ''}${s.shippedAt ? ` · ${t('studio.shippedAt')}：${new Date(s.shippedAt).toLocaleDateString()}` : ''}`
    : '';
  const completedDisplay = s.completedAt
    ? `<br />${t('studio.completedAt')}：${new Date(s.completedAt).toLocaleDateString()}`
    : '';
  return `
    <div class="draw-shipping-toggle-wrap">
      <button type="button" class="icon-btn draw-shipping-toggle" data-toggle-shipping="${draw.id}" aria-expanded="${defaultOpen}">
        ${defaultOpen ? t('studio.hideShipping') : t('studio.viewShipping')}
      </button>
    </div>
    <div class="draw-shipping-details" ${defaultOpen ? '' : 'hidden'}>
      <strong>${t('studio.shippingTo')}：</strong>${escapeHtml(s.name || '')}
      · ${escapeHtml(s.phone || '')}
      ${s.email ? ` · ${escapeHtml(s.email)}` : ''}
      <br />${escapeHtml(s.address1 || '')}
      ${s.address2 ? `<br />${escapeHtml(s.address2)}` : ''}
      <br />${escapeHtml([s.city, s.state, s.zip].filter(Boolean).join(', '))}
      <br />${escapeHtml(s.country || '')}
      ${courierDisplay}
      ${completedDisplay}
    </div>`;
}

/* ---------- studio ship modal ---------- */

function openShipModal(drawId) {
  state.studioShipDrawId = drawId;
  const modal = $('#studio-ship-modal');
  const form = $('#studio-ship-form');
  form.reset();
  const platformSelect = $('#studio-courier-platform');
  platformSelect.innerHTML = STUDIO_COURIER_PLATFORMS
    .map((c) => `<option value="${escapeHtml(c.code)}">${escapeHtml(c[state.lang] || c.en)}</option>`)
    .join('');
  modal.hidden = false;
  document.body.style.overflow = 'hidden';
}

function closeShipModal() {
  $('#studio-ship-modal').hidden = true;
  document.body.style.overflow = '';
  state.studioShipDrawId = null;
}

async function submitShip(event) {
  event.preventDefault();
  const drawId = state.studioShipDrawId;
  if (!drawId) return closeShipModal();
  const form = $('#studio-ship-form');
  const data = new FormData(form);
  const payload = {
    courierPlatform: (data.get('courierPlatform') || '').toString().trim(),
    courierCustom:   (data.get('courierCustom') || '').toString().trim(),
    trackingNumber:  (data.get('trackingNumber') || '').toString().trim()
  };
  try {
    await api(`/api/draw/${drawId}/ship`, { method: 'POST', body: payload });
    closeShipModal();
    toast(t('studio.shipDone'));
    await loadStudio();
  } catch (err) {
    toast(err.message);
  }
}

async function completeDraw(id) {
  if (!window.confirm(t('studio.confirmComplete'))) return;
  try {
    await api(`/api/draw/${id}/complete`, { method: 'POST' });
    toast(t('studio.completeDone'));
    await loadStudio();
  } catch (err) { toast(err.message); }
}

async function unshipDraw(id) {
  if (!window.confirm(t('studio.confirmUnship'))) return;
  try {
    await api(`/api/draw/${id}/unship`, { method: 'POST' });
    toast(t('studio.unshipDone'));
    await loadStudio();
  } catch (err) { toast(err.message); }
}

function setView(view) {
  state.view = view;
  els.collectionView.hidden = view !== 'collection';
  els.studioView.hidden = view !== 'studio';
  els.prizesView.hidden = view !== 'prizes';
  els.messagesView.hidden = view !== 'messages';
  els.studioBtn.textContent = view === 'studio' ? t('nav.collection') : t('nav.studio');
  els.tray.hidden = view !== 'collection';
  renderTray();
  window.scrollTo(0, 0);
}

function switchStudioTab(name) {
  const tabs = $$('.studio-tab');
  tabs.forEach((tab) => {
    const on = tab.dataset.studioTab === name;
    tab.classList.toggle('is-on', on);
    tab.setAttribute('aria-selected', String(on));
  });
  $$('[data-studio-panel]').forEach((panel) => {
    panel.hidden = panel.dataset.studioPanel !== name;
  });
  state.studioTab = name;
  window.scrollTo(0, 0);
}

async function openStudio() {
  if (state.user.role !== 'admin') return;
  setView('studio');
  switchStudioTab('collection');
  await refreshSession();
  await loadStudio();
}

async function refreshSession() {
  try {
    const data = await api('/api/session');
    applySession(data);
    if (state.user) {
      updatePoints(state.points);
      renderGrid();
      renderCounts();
      renderTray();
    }
  } catch { /* ignore */ }
}

function studioFilteredProducts() {
  const products = state.studioProducts;
  if (!state.studioCategory) return products;
  const pair = resolveCategoryPair(state.studioCategory, products);
  return products.filter((p) => {
    if (pair.zh && p.seriesZh === pair.zh) return true;
    if (pair.en && p.seriesEn === pair.en) return true;
    if (p.series === state.studioCategory) return true;
    if (p.series === pair.zh || p.series === pair.en) return true;
    return false;
  });
}

function studioPageCount() {
  return Math.max(1, Math.ceil(studioFilteredProducts().length / PAGE_SIZE));
}

function renderStudioProducts() {
  const products = state.studioProducts;
  const list = $('#studio-list');

  // --- folder pills ---
  const folders = folderCounts(products);
  if (!folders.length) {
    els.studioPills.hidden = true;
    els.studioPills.innerHTML = '';
  } else {
    if (state.studioCategory && !folders.some((f) => f.name === state.studioCategory)) {
      state.studioCategory = '';
    }
    const items = [
      { value: '', label: t('collection.all'), count: products.length },
      ...folders.map((f) => ({ value: f.name, label: f.name, count: f.count }))
    ];
    els.studioPills.innerHTML = items.map((item) => {
      const on = item.value === state.studioCategory;
      return `<button class="pill${on ? ' is-on' : ''}" type="button" data-studio-category="${escapeHtml(item.value)}" aria-pressed="${on}">
        <span>${escapeHtml(item.label)}</span><span class="pill-count">${item.count}</span>
      </button>`;
    }).join('');
    els.studioPills.hidden = false;
  }

  // --- filtering + paging ---
  const all = studioFilteredProducts();
  const pages = studioPageCount();
  if (state.studioPage > pages) state.studioPage = pages;
  if (state.studioPage < 1) state.studioPage = 1;
  const pageItems = all.slice((state.studioPage - 1) * PAGE_SIZE, state.studioPage * PAGE_SIZE);

  // --- list ---
  list.innerHTML = '';
  if (!all.length) {
    list.innerHTML = `<p class="list-empty">${state.studioCategory ? t('empty.category', { name: state.studioCategory }) : t('studio.noPieces')}</p>`;
  } else {
    pageItems.forEach((product) => {
      const row = document.createElement('div');
      row.className = 'studio-row';
      row.innerHTML = `
        <img src="${escapeHtml(product.image)}" alt="" />
        <div>
          <div class="title">${escapeHtml(getLocalized(product, 'title'))}</div>
          <div class="series">${escapeHtml(getLocalized(product, 'series') || '—')}</div>
        </div>
        <div class="voters">${product.voters.length ? escapeHtml(product.voters.join(', ')) : t('studio.noStars')}</div>
        <div class="tally">
          <span class="tally-vote">${product.likeCount || 0} 👍</span>
          <span class="tally-vote">${product.dislikeCount || 0} 👎</span>
          <span>${product.count} ★</span>
          <button class="icon-btn" data-edit="${product.id}">${t('studio.edit')}</button>
          <button class="icon-btn" data-remove="${product.id}">${t('studio.remove')}</button>
        </div>`;
      list.appendChild(row);
    });
  }

  // --- pager ---
  const show = pages > 1;
  els.studioPager.hidden = !show;
  if (show) {
    els.studioPageIndicator.textContent = `${state.studioPage} / ${pages}`;
    els.studioPagePrev.disabled = state.studioPage <= 1;
    els.studioPageNext.disabled = state.studioPage >= pages;
  }
}

async function loadStudio() {
  let data;
  try {
    data = await api('/api/studio');
  } catch (error) {
    toast(error.message);
    return;
  }

  $('#studio-count').textContent = tp('meta.pieces', data.products.length);
  $('#draw-count').textContent = tp('meta.draws', data.draws.filter((d) => d.prizeType && d.prizeType !== 'none').length);
  $('#account-count').textContent = tp('meta.accounts', data.accounts.length);

  const sf = $('#settings-form');
  if (sf && data.settings) {
    sf.winRate.value = data.settings.winRate;
    sf.framedRate.value = data.settings.framedRate;
    sf.starWeight.value = data.settings.starWeight;
  }

  // Populate series autocomplete datalists — Chinese field gets Chinese names,
  // English field gets English names. Each deduped independently.
  const zhNames = [...new Set(data.products.map((p) => p.seriesZh || p.series || '').filter(Boolean))].sort((a, b) => a.localeCompare(b, 'zh'));
  const enNames = [...new Set(data.products.map((p) => p.seriesEn || '').filter(Boolean))].sort((a, b) => a.localeCompare(b, 'en'));
  $('#series-options').innerHTML = zhNames.map((name) => `<option value="${escapeHtml(name)}"></option>`).join('');
  $('#series-options-en').innerHTML = enNames.map((name) => `<option value="${escapeHtml(name)}"></option>`).join('');

  // Render the products list with folder filtering + client-side paging.
  state.studioProducts = data.products;
  renderStudioProducts();

  const draws = $('#draw-list');
  draws.innerHTML = '';
  const winDraws = data.draws.filter((d) => d.prizeType && d.prizeType !== 'none');
  if (!winDraws.length) {
    draws.innerHTML = `<p class="list-empty">${t('studio.noDraws')}</p>`;
  } else {
    winDraws.forEach((draw) => draws.appendChild(renderStudioDrawRow(draw)));
  }

  const table = $('#account-table');
  table.innerHTML = '';
  const head = document.createElement('div');
  head.className = 'account-row head';
  head.innerHTML = `<span>${t('studio.headAccount')}</span><span class="num">${t('studio.headStars')}</span><span class="num">${t('points.label')}</span><span>${t('studio.headCode')}</span><span>${t('studio.headSecurity')}</span><span class="joined">${t('studio.headJoined')}</span><span class="actions-col">${t('studio.headActions')}</span>`;
  table.appendChild(head);

  data.accounts.forEach((account) => {
    const isSelf = state.user && account.username === state.user.username;
    const row = document.createElement('div');
    row.className = 'account-row';
    const sqBadge = account.hasSecurityQuestion
      ? `<span class="sq-badge is-set">${t('studio.sqSet')}</span>`
      : `<span class="sq-badge is-unset">${t('studio.sqNotSet')}</span>`;
    row.innerHTML = `
      <span class="name">${escapeHtml(account.username)}${account.role === 'admin' ? ` <span class="muted">${t('studio.owner')}</span>` : ''}</span>
      <span class="num">${account.stars}</span>
      <span class="num">${account.points || 0}</span>
      <span class="code-txt">${account.drawCode ? escapeHtml(account.drawCode) : '—'}</span>
      <span class="sq-cell">${sqBadge}</span>
      <span class="muted joined">${new Date(account.joined).toLocaleDateString()}</span>
      <span class="actions-col">${isSelf ? '' : `
        <button class="icon-btn" data-edit-account="${escapeHtml(account.username)}" data-points="${account.points || 0}" data-role="${account.role}" data-has-sq="${account.hasSecurityQuestion ? '1' : '0'}" data-sq="${escapeHtml(account.securityQuestion || '')}">${t('studio.edit')}</button>
        <button class="icon-btn" data-remove-account="${escapeHtml(account.username)}">${t('studio.remove')}</button>`}
      </span>`;
    table.appendChild(row);
  });
}

function openAccountEditor(username, points, role, hasSecurityQuestion, securityQuestion) {
  closeAccountEditor();
  const rows = $$('#account-table .account-row');
  const anchor = rows.find((r) => r.querySelector(`[data-edit-account="${CSS.escape(username)}"]`));
  if (!anchor) return;

  const panel = document.createElement('div');
  panel.className = 'account-edit';
  panel.id = 'account-edit';

  // Build the security-question <select> with the current question selected.
  // The stored question text may have been entered in another language, so add
  // it as an option when it isn't part of the current language's list.
  const sqSelect = document.createElement('select');
  sqSelect.id = 'account-edit-question';
  populateQuestionSelect(sqSelect, 'studio.resetSqPh');
  if (securityQuestion) {
    const exists = [...sqSelect.options].some((o) => o.value === securityQuestion);
    if (!exists) {
      const opt = document.createElement('option');
      opt.value = securityQuestion;
      opt.textContent = securityQuestion;
      sqSelect.appendChild(opt);
    }
    sqSelect.value = securityQuestion;
  }

  panel.innerHTML = `
    <input type="text" id="account-edit-pass" data-i18n-ph="studio.resetPassPh" placeholder="${t('studio.resetPassPh')}" autocomplete="off" />
    <input type="number" id="account-edit-points" min="0" step="1" value="${points}" aria-label="${t('points.label')}" />
    <select id="account-edit-role">
      <option value="guest"${role === 'guest' ? ' selected' : ''}>${t('studio.roleGuest')}</option>
      <option value="admin"${role === 'admin' ? ' selected' : ''}>${t('studio.roleAdmin')}</option>
    </select>`;
  panel.appendChild(sqSelect);
  panel.insertAdjacentHTML('beforeend', `
    <input type="text" id="account-edit-answer" data-i18n-ph="studio.resetSqAnswerPh" placeholder="${t('studio.resetSqAnswerPh')}" autocomplete="off" />
    <button class="btn btn-primary" type="button" data-save-account="${escapeHtml(username)}">${t('studio.save')}</button>
    <button class="icon-btn" type="button" data-cancel-edit>${t('studio.cancel')}</button>`);
  anchor.after(panel);
  panel.querySelector('#account-edit-pass').focus();
}

function closeAccountEditor() {
  const panel = $('#account-edit');
  if (panel) panel.remove();
}

async function submitAccountAdd(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const username = form.username.value.trim();
  const password = form.password.value;
  const securityQuestion = form.securityQuestion.value;
  const securityAnswer = form.securityAnswer.value.trim();
  $('#account-error').textContent = '';
  const body = { username, password };
  if (securityQuestion && securityAnswer) {
    body.securityQuestion = securityQuestion;
    body.securityAnswer = securityAnswer;
  }
  try {
    await api('/api/studio/accounts', { method: 'POST', body });
    form.reset();
    toast(t('studio.accountCreated'));
    await loadStudio();
  } catch (error) {
    $('#account-error').textContent = error.message;
  }
}

async function saveAccount(username) {
  const password = $('#account-edit-pass').value;
  const points = $('#account-edit-points').value;
  const role = $('#account-edit-role').value;
  const securityQuestion = $('#account-edit-question').value;
  const securityAnswer = $('#account-edit-answer').value.trim();
  const body = { password: password || undefined, points, role };
  // Only send security fields if both are provided (otherwise leave unchanged)
  if (securityQuestion && securityAnswer) {
    body.securityQuestion = securityQuestion;
    body.securityAnswer = securityAnswer;
  }
  try {
    await api(`/api/studio/accounts/${encodeURIComponent(username)}`, {
      method: 'PUT',
      body
    });
    closeAccountEditor();
    toast(t('studio.accountSaved'));
    await refreshSession();
    await loadStudio();
  } catch (error) {
    toast(error.message);
  }
}

async function removeAccount(username) {
  if (!window.confirm(t('studio.confirmRemoveAccount', { name: username }))) return;
  try {
    await api(`/api/studio/accounts/${encodeURIComponent(username)}`, { method: 'DELETE' });
    toast(t('studio.accountRemoved'));
    await loadStudio();
  } catch (error) {
    toast(error.message);
  }
}

/* ---------- upload ---------- */

let uploadFile = null;

function setupDropzone() {
  const zone = $('#dropzone');
  const input = $('#file-input');
  const preview = $('#upload-preview');
  const msg = $('#dropzone-msg');

  const accept = (file) => {
    if (!file || !file.type.startsWith('image/')) {
      $('#upload-error').textContent = t('studio.errImage');
      return;
    }
    uploadFile = file;
    const reader = new FileReader();
    reader.onload = () => {
      preview.src = reader.result;
      preview.hidden = false;
      msg.hidden = true;
    };
    reader.readAsDataURL(file);
    $('#upload-error').textContent = '';
  };

  zone.addEventListener('click', () => input.click());
  zone.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      input.click();
    }
  });
  input.addEventListener('change', () => accept(input.files[0]));

  ['dragenter', 'dragover'].forEach((type) => {
    zone.addEventListener(type, (event) => {
      event.preventDefault();
      zone.classList.add('is-over');
    });
  });
  ['dragleave', 'drop'].forEach((type) => {
    zone.addEventListener(type, (event) => {
      event.preventDefault();
      zone.classList.remove('is-over');
    });
  });
  zone.addEventListener('drop', (event) => {
    const file = event.dataTransfer.files[0];
    accept(file);
  });
}

function resetUploadForm() {
  uploadFile = null;
  $('#upload-form').reset();
  $('#upload-preview').hidden = true;
  $('#upload-preview').removeAttribute('src');
  $('#dropzone-msg').hidden = false;
  $('#upload-error').textContent = '';
  $('#upload-submit').disabled = false;
  $('#upload-submit').textContent = t('studio.submit');
}

async function submitUpload(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const titleZh = form.titleZh.value.trim();
  const titleEn = form.titleEn.value.trim();
  if (!titleZh && !titleEn) {
    $('#upload-error').textContent = t('studio.errTitle');
    return;
  }
  if (!uploadFile) {
    $('#upload-error').textContent = t('studio.errNeedImage');
    return;
  }

  const button = $('#upload-submit');
  button.disabled = true;
  button.textContent = t('studio.translating');
  $('#upload-error').textContent = '';

  const seriesZh = form.seriesZh.value.trim();
  const seriesEn = form.seriesEn.value.trim();
  const noteZh = form.noteZh.value.trim();
  const noteEn = form.noteEn.value.trim();

  // Auto-fill empty English fields by translating from Chinese
  const [finalTitleEn, finalSeriesEn, finalNoteEn] = await Promise.all([
    titleEn ? titleEn : (titleZh ? translateToEnglish(titleZh) : ''),
    seriesEn ? seriesEn : (seriesZh ? translateToEnglish(seriesZh) : ''),
    noteEn ? noteEn : (noteZh ? translateToEnglish(noteZh) : '')
  ]);

  // Sync back the auto-translated values to the form so user can see them
  form.titleEn.value = finalTitleEn;
  form.seriesEn.value = finalSeriesEn;
  form.noteEn.value = finalNoteEn;

  const body = new FormData();
  body.append('titleZh', titleZh);
  body.append('titleEn', finalTitleEn);
  body.append('seriesZh', seriesZh);
  body.append('seriesEn', finalSeriesEn);
  body.append('noteZh', noteZh);
  body.append('noteEn', finalNoteEn);
  body.append('image', uploadFile);

  button.textContent = t('studio.adding');

  try {
    await api('/api/studio/products', { method: 'POST', body });
    resetUploadForm();
    await refreshSession();
    await loadStudio();
  } catch (error) {
    $('#upload-error').textContent = error.message;
    button.disabled = false;
    button.textContent = t('studio.submit');
  }
}

async function removeProduct(id) {
  const product = productById(id) || { title: t('studio.remove') };
  const displayTitle = productById(id) ? getLocalized(product, 'title') : t('studio.remove');
  if (!window.confirm(t('studio.confirmRemove', { title: displayTitle }))) return;
  try {
    await api(`/api/studio/products/${id}`, { method: 'DELETE' });
    await refreshSession();
    await loadStudio();
  } catch (error) {
    toast(error.message);
  }
}

/* ---------- product editor ---------- */

let editingProductId = null;

function openProductEditor(id) {
  const product = productById(id);
  if (!product) return;
  editingProductId = id;

  const modal = $('#product-edit-modal');
  const form = $('#product-edit-form');
  form.titleZh.value = product.titleZh || '';
  form.titleEn.value = product.titleEn || '';
  form.seriesZh.value = product.seriesZh || '';
  form.seriesEn.value = product.seriesEn || '';
  form.noteZh.value = product.noteZh || '';
  form.noteEn.value = product.noteEn || '';
  $('#product-edit-error').textContent = '';
  modal.hidden = false;
  document.body.style.overflow = 'hidden';
}

function closeProductEditor() {
  editingProductId = null;
  $('#product-edit-modal').hidden = true;
  $('#product-edit-error').textContent = '';
  document.body.style.overflow = '';
}

async function saveProductEditor(event) {
  event.preventDefault();
  if (!editingProductId) return;
  const form = event.currentTarget;
  const titleZh = form.titleZh.value.trim();
  const titleEn = form.titleEn.value.trim();
  if (!titleZh && !titleEn) {
    $('#product-edit-error').textContent = t('studio.errTitle');
    return;
  }

  const button = $('#product-edit-save');
  button.disabled = true;
  $('#product-edit-error').textContent = '';

  const seriesZh = form.seriesZh.value.trim();
  const seriesEn = form.seriesEn.value.trim();
  const noteZh = form.noteZh.value.trim();
  const noteEn = form.noteEn.value.trim();

  // Auto-fill empty EN fields by translating from ZH
  const [finalTitleEn, finalSeriesEn, finalNoteEn] = await Promise.all([
    titleEn ? titleEn : (titleZh ? translateToEnglish(titleZh) : ''),
    seriesEn ? seriesEn : (seriesZh ? translateToEnglish(seriesZh) : ''),
    noteEn ? noteEn : (noteZh ? translateToEnglish(noteZh) : '')
  ]);
  form.titleEn.value = finalTitleEn;
  form.seriesEn.value = finalSeriesEn;
  form.noteEn.value = finalNoteEn;

  try {
    await api(`/api/studio/products/${encodeURIComponent(editingProductId)}`, {
      method: 'PUT',
      body: {
        titleZh, titleEn: finalTitleEn,
        seriesZh, seriesEn: finalSeriesEn,
        noteZh, noteEn: finalNoteEn
      }
    });
    closeProductEditor();
    await refreshSession();
    await loadStudio();
  } catch (error) {
    $('#product-edit-error').textContent = error.message;
  } finally {
    button.disabled = false;
  }
}

async function removeDraw(id, name, code) {
  if (!window.confirm(t('studio.confirmRemoveDraw', { name, code }))) return;
  try {
    await api(`/api/studio/draws/${id}`, { method: 'DELETE' });
    await refreshSession();
    await loadStudio();
  } catch (error) {
    toast(error.message);
  }
}

async function submitSettings(event) {
  event.preventDefault();
  const f = event.target;
  $('#settings-error').textContent = '';
  try {
    await api('/api/studio/settings', {
      method: 'PUT',
      body: { winRate: f.winRate.value, framedRate: f.framedRate.value, starWeight: f.starWeight.value }
    });
    toast(t('studio.settingsSaved'));
  } catch (error) {
    $('#settings-error').textContent = error.message;
  }
}

/* ---------- 管理员：消息管理 ---------- */

let studioMessages = { threads: [], selectedUserId: null };

async function openStudioMessages() {
  // 进入 messages tab 时加载 thread 列表
  await loadStudioThreads();
}

async function loadStudioThreads() {
  try {
    const data = await api('/api/studio/messages');
    studioMessages.threads = data.threads || [];
    renderStudioThreads(data.totalUnread || 0);
  } catch (err) {
    toast(err.message);
  }
}

function renderStudioThreads(totalUnread) {
  const list = $('#studio-threads-list');
  if (!list) return;
  list.innerHTML = '';
  if (!studioMessages.threads.length) {
    list.innerHTML = `<p class="list-empty">${t('studio.msgEmpty')}</p>`;
  } else {
    studioMessages.threads.forEach((th) => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'studio-thread-item' + (studioMessages.selectedUserId === th.userId ? ' is-on' : '');
      const lastPreview = th.lastMessage
        ? `${th.lastMessage.fromUser ? '👤' : '🏠'} ${escapeHtml(truncate(th.lastMessage.content, 40))}`
        : '';
      const time = th.lastMessage ? new Date(th.lastMessage.createdAt).toLocaleDateString() : '';
      const statusHint = th.latestDrawStatus
        ? `<span class="muted">· ${t('studio.status' + capitalize(th.latestDrawStatus))}</span>`
        : '';
      item.innerHTML = `
        <div class="thread-head">
          <strong>${escapeHtml(th.username)}</strong>
          ${th.unreadByAdmin > 0 ? `<span class="badge">${th.unreadByAdmin}</span>` : ''}
        </div>
        <div class="thread-preview">${lastPreview}</div>
        <div class="thread-meta">${time} · ${t('studio.msgTotal', { n: th.total })}${statusHint}</div>`;
      item.addEventListener('click', () => openStudioThread(th.userId));
      list.appendChild(item);
    });
  }
  // tab 徽章
  const tab = document.querySelector('[data-studio-tab="messages"]');
  if (tab) {
    if (totalUnread > 0) { tab.dataset.unread = String(totalUnread); tab.classList.add('has-badge'); }
    else { delete tab.dataset.unread; tab.classList.remove('has-badge'); }
  }
}

async function openStudioThread(userId) {
  studioMessages.selectedUserId = userId;
  renderStudioThreads(0);
  const replyWrap = $('#studio-reply-wrap');
  if (replyWrap) replyWrap.hidden = false;
  try {
    const r = await api(`/api/studio/messages/${userId}`);
    renderStudioThreadView(r.thread || []);
    // 清掉 tab 的总未读数
    const t = await api('/api/studio/messages');
    renderStudioThreads(t.totalUnread || 0);
  } catch (err) {
    toast(err.message);
  }
}

function renderStudioThreadView(thread) {
  const box = $('#studio-thread-view');
  box.innerHTML = '';
  if (!thread.length) {
    box.innerHTML = `<p class="list-empty">${t('studio.msgEmpty')}</p>`;
    return;
  }
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

async function sendStudioReply() {
  const userId = studioMessages.selectedUserId;
  if (!userId) return toast(t('studio.msgPickThread'));
  const input = $('#studio-msg-input');
  const content = (input.value || '').trim();
  if (!content) return;
  try {
    await api(`/api/studio/messages/${userId}`, { method: 'POST', body: { content } });
    input.value = '';
    await openStudioThread(userId);
    await loadStudioThreads();
  } catch (err) { toast(err.message); }
}

function truncate(s, n) { return String(s || '').length > n ? s.slice(0, n) + '…' : s; }
function capitalize(s) { return s ? s[0].toUpperCase() + s.slice(1) : ''; }
