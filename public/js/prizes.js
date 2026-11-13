/* StarCull · 中奖记录：列表与配送维护 */

async function openPrizes() {
  setView('prizes');
  await loadPrizes();
}

async function loadPrizes() {
  try {
    const data = await api('/api/draws');
    if (typeof data.points === 'number') updatePoints(data.points);
    renderPrizes(data.draws || []);
  } catch (error) {
    toast(error.message);
  }
}

function prizeStatusLabel(status) {
  switch (status) {
    case 'preparing': return t('shipping.statusPreparing');
    case 'shipped':   return t('shipping.statusShipped');
    case 'done':      return t('shipping.statusDone');
    default:          return t('shipping.statusPending');
  }
}

function renderPrizes(draws) {
  els.prizesList.innerHTML = '';
  if (!draws.length) {
    els.prizesEmpty.hidden = false;
    return;
  }
  els.prizesEmpty.hidden = true;

  draws.forEach((draw) => {
    const card = document.createElement('div');
    card.className = 'prize-card';

    const isNone = draw.prizeType === 'none';
    const typeLabel = isNone
      ? t('prizes.prizeTypeNone')
      : draw.prizeType === 'framed' ? t('draw.typeFramed') : t('draw.typeCanvas');

    const dateStr = new Date(draw.createdAt).toLocaleDateString();
    const editable = draw.status === 'pending' || draw.status === 'preparing';

    let actionsHtml = '';
    if (!isNone) {
      if (draw.shipping && editable) {
        actionsHtml = `<button class="btn btn-ghost" data-action="edit">${t('shipping.editForm')}</button>
                       <button class="btn btn-ghost" data-action="delete">${t('shipping.delete')}</button>`;
      } else if (!draw.shipping) {
        actionsHtml = `<button class="btn btn-primary" data-action="edit">${t('shipping.fillForm')}</button>`;
      } else {
        // shipped / done — 锁定，用户不能再改
        actionsHtml = `<span class="muted">${t('shipping.lockedHint')}</span>`;
      }
    }

    const shippingHtml = draw.shipping
      ? `<div class="prize-shipping">
           <strong>${escapeHtml(draw.shipping.name)}</strong><br />
           ${escapeHtml(draw.shipping.address1)}${draw.shipping.address2 ? ', ' + escapeHtml(draw.shipping.address2) : ''}<br />
           ${escapeHtml(draw.shipping.city)}, ${escapeHtml(draw.shipping.state)} ${escapeHtml(draw.shipping.zip)}<br />
           ${escapeHtml(draw.shipping.country)} · ${escapeHtml(draw.shipping.phone)}
           ${draw.shipping.trackingNumber
             ? `<br /><span class="prize-courier">${t('shipping.courierLabel')}：${escapeHtml(draw.shipping.trackingNumber)}</span>`
             : ''}
         </div>`
      : `<div class="prize-shipping muted">${t('shipping.noShipping')}</div>`;

    const statusLabel = prizeStatusLabel(draw.status);

    card.innerHTML = `
      ${draw.product ? `<div class="prize-thumb"><img src="${draw.product.image}" alt="" /></div>` : ''}
      <div class="prize-info">
        <div class="prize-head">
          <span class="result-type ${draw.prizeType === 'framed' ? 'is-framed' : isNone ? '' : 'is-canvas'}">${typeLabel}</span>
          <span class="prize-status">${statusLabel}</span>
        </div>
        ${draw.product ? `<h3 class="prize-title">${escapeHtml(getLocalized(draw.product, 'title'))}</h3>` : ''}
        <p class="prize-meta">${t('prizes.date')}: ${dateStr}${draw.code ? ` · ${t('prizes.code')}: ${escapeHtml(draw.code)}` : ''}${draw.pointsSpent ? ` · ${t('shipping.pointsSpent', { n: draw.pointsSpent })}` : ''}</p>
        ${!isNone ? shippingHtml : ''}
        <div class="prize-actions">${actionsHtml}</div>
      </div>
    `;

    card.querySelectorAll('[data-action]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const action = btn.dataset.action;
        if (action === 'edit') openDrawForShipping(draw);
        else if (action === 'delete') deletePrizeShipping(draw);
      });
    });

    els.prizesList.appendChild(card);
  });
}

function openDrawForShipping(draw) {
  state.draw = draw;
  fillResult(draw, true);
  els.draw.hidden = false;
  els.drawRolling.hidden = true;
  els.drawResult.hidden = false;
  document.body.style.overflow = 'hidden';
}

async function deletePrizeShipping(draw) {
  if (!draw || !draw.id) return;
  try {
    const data = await api(`/api/draw/${draw.id}/shipping`, { method: 'DELETE' });
    if (typeof data.points === 'number') updatePoints(data.points);
    toast(data.refunded ? t('shipping.refunded', { n: data.refunded }) : t('shipping.deleted'));
    await loadPrizes();
  } catch (error) {
    toast(error.message);
  }
}
