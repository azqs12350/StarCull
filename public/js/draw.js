/* StarCull · 抽奖：抽奖动画、结果与收货 */

/* ---------- tray ---------- */

function hasFreeDraw() {
  if (!state.user || state.user.freeDrawClaimed) return false;
  const createdAt = new Date(state.user.createdAt).getTime();
  const threeDaysAgo = Date.now() - 3 * 24 * 3600 * 1000;
  return createdAt <= threeDaysAgo;
}

function renderTray() {
  if (!state.user || state.view !== 'collection') {
    els.tray.hidden = true;
    return;
  }

  // A prize waiting for shipping details is surfaced as a secondary link,
  // but the draw button always stays available so players can keep drawing.
  const pendingGift = !!(state.draw && state.draw.prizeType && state.draw.prizeType !== 'none' && state.draw.status !== 'shipped' && state.draw.status !== 'done');
  const count = starredProducts().length;
  const free = hasFreeDraw();

  els.tray.hidden = false;
  els.tray.classList.toggle('is-gifted', pendingGift);

  if (pendingGift) {
    els.trayCount.textContent = state.draw.product ? getLocalized(state.draw.product, 'title') : t('draw.typeCanvas');
    els.trayLabel.textContent = t('tray.yours');
    els.traySub.textContent = state.draw.code ? t('tray.code', { code: state.draw.code }) : '';
  } else {
    els.trayCount.textContent = String(count);
    els.trayLabel.textContent = tp('tray.label', count);
    els.traySub.textContent = free
      ? t('draw.freeDraw')
      : t('draw.costsPoints', { n: 50 });
  }

  els.trayGiftBtn.hidden = !pendingGift;
  els.drawBtn.textContent = t('tray.draw');
  els.drawBtn.disabled = false;
}

/* ---------- lightbox ---------- */

function openLightbox(id) {
  const product = productById(id);
  if (!product) return;
  els.lightboxImage.src = product.image;
  els.lightboxImage.alt = getLocalized(product, 'title');
  els.lightboxTitle.textContent = getLocalized(product, 'title');
  els.lightboxSeries.textContent = getLocalized(product, 'series') || 'StarCull';
  els.lightboxNote.textContent = getLocalized(product, 'note');
  els.lightboxStar.dataset.id = id;
  els.lightboxStar.setAttribute('aria-pressed', String(product.starred));
  els.lightboxStar.classList.toggle('is-on', product.starred);
  $('span', els.lightboxStar).textContent = product.starred ? t('piece.starred') : t('piece.star');

  els.lightboxLike.dataset.id = id;
  els.lightboxLike.setAttribute('aria-pressed', String(product.liked));
  els.lightboxLike.classList.toggle('is-on', product.liked);
  $('.count', els.lightboxLike).textContent = product.likeCount || '';

  els.lightboxDislike.dataset.id = id;
  els.lightboxDislike.setAttribute('aria-pressed', String(product.disliked));
  els.lightboxDislike.classList.toggle('is-on', product.disliked);
  $('.count', els.lightboxDislike).textContent = product.dislikeCount || '';

  els.lightbox.hidden = false;
  document.body.style.overflow = 'hidden';
}

function closeLightbox() {
  els.lightbox.hidden = true;
  document.body.style.overflow = '';
  els.lightboxStar.dataset.id = '';
}

/* ---------- draw ---------- */

async function startDraw() {
  els.drawBtn.disabled = true;
  try {
    const data = await api('/api/draw', { method: 'POST' });
    state.draw = data.draw;
    if (typeof data.points === 'number') updatePoints(data.points);
    rollDraw(data.draw);
  } catch (error) {
    toast(error.message);
  } finally {
    els.drawBtn.disabled = false;
  }
}

function rollDraw(draw) {
  els.draw.hidden = false;
  els.drawRolling.hidden = false;
  els.drawResult.hidden = true;
  document.body.style.overflow = 'hidden';

  const titles = state.products.length ? state.products.map((p) => getLocalized(p, 'title')) : ['StarCull'];
  let index = 0;
  let delay = 58;

  const tick = () => {
    els.slot.textContent = titles[index % titles.length];
    index += 1;
    delay *= 1.135;
    if (delay < 360) {
      setTimeout(tick, delay);
    } else {
      setTimeout(() => {
        fillResult(draw);
        els.drawRolling.hidden = true;
        els.drawResult.hidden = false;
        renderTray();
      }, 430);
    }
  };

  setTimeout(tick, 200);
}

function updateShippingRequired() {
  const f = els.shippingForm;
  if (!f || f.hidden) return;
  const country = (f.country.value || '').trim();
  const isChina = country === 'China' || country === '中国';
  const stateLabel = f.state.closest('.field').querySelector('span');
  const zipLabel = f.zip.closest('.field').querySelector('span');
  if (isChina) {
    f.state.removeAttribute('required');
    f.zip.removeAttribute('required');
    f.state.removeAttribute('aria-required');
    f.zip.removeAttribute('aria-required');
    if (stateLabel) stateLabel.textContent = stateLabel.textContent.replace(/\s*\*?$/, '（可选）');
    if (zipLabel) zipLabel.textContent = zipLabel.textContent.replace(/\s*\*?$/, '（可选）');
  } else {
    f.state.setAttribute('required', 'required');
    f.zip.setAttribute('required', 'required');
    f.state.setAttribute('aria-required', 'true');
    f.zip.setAttribute('aria-required', 'true');
    if (stateLabel) stateLabel.textContent = stateLabel.textContent.replace(/\s*（可选）\*?$/, ' *').replace(/\s*\*$/, ' *');
    if (zipLabel) zipLabel.textContent = zipLabel.textContent.replace(/\s*（可选）\*?$/, ' *').replace(/\s*\*$/, ' *');
  }
}

function fillResult(draw, edit) {
  // Reset all sections
  els.resultPrize.hidden = true;
  els.resultNone.hidden = true;
  els.shippingForm.hidden = true;
  els.shippingConfirmed.hidden = true;
  els.upgradeOption.hidden = true;
  els.shippingError.textContent = '';
  applyLanguage();

  if (draw.prizeType === 'none') {
    els.resultKicker.innerHTML = t('draw.kicker');
    els.resultNone.hidden = false;
    return;
  }

  const product = draw.product;
  if (product) {
    els.resultKicker.innerHTML = t('draw.gifted');
    els.resultPrize.hidden = false;
    $('#result-image').src = product.image;
    $('#result-image').alt = getLocalized(product, 'title');
    $('#result-title').textContent = getLocalized(product, 'title');
    $('#result-series').textContent = getLocalized(product, 'series') || 'StarCull';
    $('#result-code').textContent = draw.code || '';
  }

  // Prize type badge
  els.resultType.textContent = draw.prizeType === 'framed' ? t('draw.typeFramed') : t('draw.typeCanvas');
  els.resultType.className = 'result-type ' + (draw.prizeType === 'framed' ? 'is-framed' : 'is-canvas');

  // Shipping form visibility
  // 用户只能在 pending / preparing 时编辑；edit=true 从"我的奖品"进入尝试编辑，
  // 但后端会在 shipped/done 时拒绝，所以前端这里也锁上。
  const isLocked = draw.status === 'shipped' || draw.status === 'done';
  const showForm = !isLocked && (edit || !draw.shipping || draw.status === 'pending');
  if (showForm) {
    els.shippingForm.hidden = false;
    // Pre-fill existing shipping data
    if (draw.shipping) {
      const f = els.shippingForm;
      f.name.value = draw.shipping.name || '';
      f.phone.value = draw.shipping.phone || '';
      f.email.value = draw.shipping.email || '';
      f.address1.value = draw.shipping.address1 || '';
      f.address2.value = draw.shipping.address2 || '';
      f.city.value = draw.shipping.city || '';
      f.state.value = draw.shipping.state || '';
      f.zip.value = draw.shipping.zip || '';
      f.country.value = draw.shipping.country || 'USA';
      els.upgradeCheckbox.checked = !!draw.framedUpgrade;
    } else {
      els.shippingForm.reset();
      els.upgradeCheckbox.checked = false;
    }
    // Show upgrade option only for canvas not yet upgraded
    if (draw.prizeType === 'canvas' && !draw.framedUpgrade) {
      els.upgradeOption.hidden = false;
    }
    updateShippingRequired();
  } else {
    els.shippingConfirmed.hidden = false;
  }
}

function openDrawResult(draw) {
  fillResult(draw);
  els.draw.hidden = false;
  els.drawRolling.hidden = true;
  els.drawResult.hidden = false;
  document.body.style.overflow = 'hidden';
}

function closeDraw() {
  els.draw.hidden = true;
  els.drawRolling.hidden = false;
  els.drawResult.hidden = true;
  document.body.style.overflow = '';
}

async function submitShipping(event) {
  event.preventDefault();
  const draw = state.draw;
  if (!draw || !draw.id) return;

  const form = event.currentTarget;
  if (!els.privacyCheckbox.checked) {
    els.shippingError.textContent = t('shipping.errPrivacy');
    return;
  }

  const fd = new FormData(form);
  const body = {
    name: String(fd.get('name') || '').trim(),
    phone: String(fd.get('phone') || '').trim(),
    email: String(fd.get('email') || '').trim(),
    address1: String(fd.get('address1') || '').trim(),
    address2: String(fd.get('address2') || '').trim(),
    city: String(fd.get('city') || '').trim(),
    state: String(fd.get('state') || '').trim(),
    zip: String(fd.get('zip') || '').trim(),
    country: String(fd.get('country') || '').trim(),
    upgradeToFramed: els.upgradeCheckbox.checked
  };

  els.shippingSubmit.disabled = true;
  els.shippingError.textContent = '';

  const method = draw.status === 'preparing' ? 'PUT' : 'POST';

  try {
    const data = await api(`/api/draw/${draw.id}/shipping`, { method, body });
    state.draw = data.draw;
    if (typeof data.points === 'number') updatePoints(data.points);
    fillResult(state.draw);
    renderTray();
    toast(draw.status === 'confirmed' ? t('shipping.updated') : t('shipping.submitted'));
  } catch (error) {
    els.shippingError.textContent = error.message;
  } finally {
    els.shippingSubmit.disabled = false;
  }
}

async function cancelShipping() {
  const draw = state.draw;
  if (!draw || !draw.id) return;
  try {
    const data = await api(`/api/draw/${draw.id}/cancel`, { method: 'POST' });
    state.draw = data.draw;
    if (typeof data.points === 'number') updatePoints(data.points);
    fillResult(state.draw);
    renderTray();
    const msg = data.refunded ? t('shipping.refunded', { n: data.refunded }) : t('shipping.cancelled');
    toast(msg);
  } catch (error) {
    els.shippingError.textContent = error.message;
  }
}
