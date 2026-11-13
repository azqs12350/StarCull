/* StarCull · 入口：事件绑定与启动 */

/* ---------- wiring ---------- */

$$('.switch-btn').forEach((btn) => {
  btn.addEventListener('click', () => setAuthMode(btn.dataset.mode));
});

document.addEventListener('click', (event) => {
  const langBtn = event.target.closest('.lang-btn');
  if (langBtn) {
    event.preventDefault();
    setLang(langBtn.dataset.lang);
  }
});

els.authForm.addEventListener('submit', submitAuth);

/* ---------- password recovery wiring ---------- */

$('#forgot-password-btn').addEventListener('click', openRecoverModal);
$('#recover-step1').addEventListener('submit', submitRecoverStep1);
$('#recover-step2').addEventListener('submit', submitRecoverStep2);
$('#recover-close').addEventListener('click', closeRecoverModal);
$('#recover-cancel1').addEventListener('click', closeRecoverModal);
$('#recover-done').addEventListener('click', finishRecover);
$('#recover-back').addEventListener('click', () => {
  $('#recover-step2').hidden = true;
  $('#recover-step1').hidden = false;
  $('#recover-error2').textContent = '';
});
$('#recover-modal').addEventListener('click', (event) => {
  if (event.target.id === 'recover-modal') closeRecoverModal();
});

/* ---------- forced security-question setup wiring ---------- */

$('#sq-setup-form').addEventListener('submit', submitSecurityQuestionSetup);

$('#signout').addEventListener('click', signOut);

$('#go-home').addEventListener('click', () => setView('collection'));

els.studioBtn.addEventListener('click', () => {
  if (state.view === 'studio') setView('collection');
  else openStudio();
});

els.prizesBtn.addEventListener('click', openPrizes);
els.prizesBack.addEventListener('click', () => setView('collection'));
els.messagesBtn.addEventListener('click', openMessages);
els.msgBell.addEventListener('click', openMessages);
els.messagesBack.addEventListener('click', () => setView('collection'));
$('#messages-send').addEventListener('click', sendMessage);
$('#messages-input').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } });
$('#studio-msg-send').addEventListener('click', sendStudioReply);
$('#studio-msg-input').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendStudioReply(); } });
els.bonusClose.addEventListener('click', hideBonusPopup);
els.bonusModal.addEventListener('click', (e) => { if (e.target === els.bonusModal) hideBonusPopup(); });

$('#back-btn').addEventListener('click', () => setView('collection'));

document.addEventListener('click', (event) => {
  const tab = event.target.closest('.studio-tab');
  if (!tab) return;
  event.preventDefault();
  const name = tab.dataset.studioTab;
  switchStudioTab(name);
  if (name === 'messages') openStudioMessages();
});

els.starredFilter.addEventListener('click', () => {
  state.starredOnly = !state.starredOnly;
  state.page = 1;
  renderCollection();
});

els.categoryPills.addEventListener('click', (event) => {
  const pill = event.target.closest('.pill');
  if (!pill) return;
  state.category = pill.dataset.category || '';
  state.page = 1;
  els.grid.scrollTop = 0;
  renderCollection();
});

els.pagePrev.addEventListener('click', () => {
  if (state.page <= 1) return;
  state.page -= 1;
  els.grid.scrollTop = 0;
  renderCollection();
});

els.pageNext.addEventListener('click', () => {
  if (state.page >= pageCount()) return;
  state.page += 1;
  els.grid.scrollTop = 0;
  renderCollection();
});

// Studio collection: folder filter + paging
els.studioPills.addEventListener('click', (event) => {
  const pill = event.target.closest('.pill');
  if (!pill) return;
  state.studioCategory = pill.dataset.studioCategory || '';
  state.studioPage = 1;
  els.studioPills.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  renderStudioProducts();
});

els.studioPagePrev.addEventListener('click', () => {
  if (state.studioPage <= 1) return;
  state.studioPage -= 1;
  els.studioPills.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  renderStudioProducts();
});

els.studioPageNext.addEventListener('click', () => {
  if (state.studioPage >= studioPageCount()) return;
  state.studioPage += 1;
  els.studioPills.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  renderStudioProducts();
});

boardQuery.addEventListener('change', () => {
  state.page = 1;
  if (state.user && state.view === 'collection') renderCollection();
});

els.grid.addEventListener('click', (event) => {
  const star = event.target.closest('.star');
  if (star) {
    event.preventDefault();
    toggleStar(star.dataset.star, star);
    return;
  }
  const like = event.target.closest('.vote-like');
  if (like) {
    event.preventDefault();
    toggleLike(like.dataset.like, like);
    return;
  }
  const dislike = event.target.closest('.vote-dislike');
  if (dislike) {
    event.preventDefault();
    toggleDislike(dislike.dataset.dislike, dislike);
    return;
  }
  const opener = event.target.closest('[data-open]');
  if (opener) openLightbox(opener.dataset.open);
});

els.lightbox.addEventListener('click', (event) => {
  if (event.target === els.lightbox) closeLightbox();
});
$('#lightbox-close').addEventListener('click', closeLightbox);

els.lightboxStar.addEventListener('click', () => {
  const id = els.lightboxStar.dataset.id;
  if (id) toggleStar(id);
});
els.lightboxLike.addEventListener('click', () => {
  const id = els.lightboxLike.dataset.id;
  if (id) toggleLike(id);
});
els.lightboxDislike.addEventListener('click', () => {
  const id = els.lightboxDislike.dataset.id;
  if (id) toggleDislike(id);
});

els.drawBtn.addEventListener('click', startDraw);
els.trayGiftBtn.addEventListener('click', () => {
  if (state.draw && state.draw.prizeType && state.draw.prizeType !== 'none') openDrawResult(state.draw);
});
$('#result-close').addEventListener('click', closeDraw);
$('#result-close-none').addEventListener('click', closeDraw);
$('#result-close-confirmed').addEventListener('click', closeDraw);

if (els.shippingForm) {
  els.shippingForm.addEventListener('submit', submitShipping);
  els.shippingCancel.addEventListener('click', cancelShipping);
  els.shippingEdit.addEventListener('click', () => fillResult(state.draw, true));
  els.shippingForm.country.addEventListener('change', updateShippingRequired);
}

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  if (!els.lightbox.hidden) closeLightbox();
  else if (!els.draw.hidden) closeDraw();
});

$('#upload-form').addEventListener('submit', submitUpload);
$('#upload-form').addEventListener('click', (event) => {
  const btn = event.target.closest('.translate-btn');
  if (btn) {
    event.preventDefault();
    handleTranslateClick(btn);
  }
});
$('#studio-list').addEventListener('click', (event) => {
  const editBtn = event.target.closest('[data-edit]');
  if (editBtn) { openProductEditor(editBtn.dataset.edit); return; }
  const btn = event.target.closest('[data-remove]');
  if (btn) removeProduct(btn.dataset.remove);
});

/* ---------- product edit modal wiring ---------- */

$('#product-edit-form').addEventListener('submit', saveProductEditor);
$('#product-edit-form').addEventListener('click', (event) => {
  const btn = event.target.closest('.translate-btn');
  if (btn) { event.preventDefault(); handleTranslateClick(btn); }
});
$('#product-edit-close').addEventListener('click', closeProductEditor);
$('#product-edit-cancel').addEventListener('click', closeProductEditor);
$('#product-edit-modal').addEventListener('click', (event) => {
  if (event.target.id === 'product-edit-modal') closeProductEditor();
});

/* ---------- draw list ---------- */
$('#draw-list').addEventListener('click', (event) => {
  const toggle = event.target.closest('[data-toggle-shipping]');
  if (toggle) {
    const row = toggle.closest('.draw-row');
    const panel = row && row.querySelector('.draw-shipping-details');
    if (panel) {
      panel.hidden = !panel.hidden;
      toggle.setAttribute('aria-expanded', String(!panel.hidden));
      toggle.textContent = panel.hidden ? t('studio.viewShipping') : t('studio.hideShipping');
    }
    return;
  }
  const shipBtn = event.target.closest('[data-ship]');
  if (shipBtn) { openShipModal(shipBtn.dataset.ship); return; }
  const completeBtn = event.target.closest('[data-complete]');
  if (completeBtn) { completeDraw(completeBtn.dataset.complete); return; }
  const unshipBtn = event.target.closest('[data-unship]');
  if (unshipBtn) { unshipDraw(unshipBtn.dataset.unship); return; }
  const btn = event.target.closest('[data-remove-draw]');
  if (btn) removeDraw(btn.dataset.removeDraw, btn.dataset.name, btn.dataset.code);
});
$('#studio-ship-form').addEventListener('submit', submitShip);
$('#studio-ship-close').addEventListener('click', closeShipModal);
$('#studio-ship-cancel').addEventListener('click', closeShipModal);
$('#settings-form').addEventListener('submit', submitSettings);

$('#account-add-form').addEventListener('submit', submitAccountAdd);
$('#account-table').addEventListener('click', (event) => {
  const edit = event.target.closest('[data-edit-account]');
  if (edit) {
    openAccountEditor(
      edit.dataset.editAccount,
      edit.dataset.points,
      edit.dataset.role,
      edit.dataset.hasSq === '1',
      edit.dataset.sq || ''
    );
    return;
  }
  const save = event.target.closest('[data-save-account]');
  if (save) {
    saveAccount(save.dataset.saveAccount);
    return;
  }
  if (event.target.closest('[data-cancel-edit]')) {
    closeAccountEditor();
    return;
  }
  const remove = event.target.closest('[data-remove-account]');
  if (remove) removeAccount(remove.dataset.removeAccount);
});

setupDropzone();
$('#year').textContent = new Date().getFullYear();

$('#auth-image').src = '/1.jpeg';
$('#auth-image').addEventListener('error', (event) => {
  event.target.style.display = 'none';
});

/* ---------- boot ---------- */

applyLanguage();

(async function boot() {
  try {
    const data = await api('/api/session');
    applySession(data);
    if (data.user) enterApp();
    else showAuth();
  } catch {
    showAuth();
  }
})();
