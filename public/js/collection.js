/* StarCull · 画廊：列表、分页、筛选与投票 */

function renderCollection() {
  renderPills();
  renderGrid();
  renderCounts();
  renderPager();
  renderTray();
}

function renderPills() {
  const folders = folderCounts();
  if (!folders.length) {
    els.categoryPills.hidden = true;
    els.categoryPills.innerHTML = '';
    return;
  }

  if (state.category && !folders.some((f) => f.name === state.category)) {
    state.category = folders[0].name;
  }

  const items = [
    { value: '', label: t('collection.all'), count: state.products.length },
    ...folders.map((f) => ({ value: f.name, label: f.name, count: f.count }))
  ];

  els.categoryPills.innerHTML = items.map((item) => {
    const on = item.value === state.category;
    return `<button class="pill${on ? ' is-on' : ''}" type="button" data-category="${escapeHtml(item.value)}" aria-pressed="${on}">
      <span>${escapeHtml(item.label)}</span><span class="pill-count">${item.count}</span>
    </button>`;
  }).join('');
  els.categoryPills.hidden = false;
}

function renderPager() {
  const pages = pageCount();
  if (state.page > pages) state.page = pages;
  const show = pages > 1;
  els.pager.hidden = !show;
  if (!show) return;
  els.pageIndicator.textContent = `${state.page} / ${pages}`;
  els.pagePrev.disabled = state.page <= 1;
  els.pageNext.disabled = state.page >= pages;
}

function renderCounts() {
  const starred = starredProducts().length;
  els.pieceCount.textContent = tp('meta.pieces', state.products.length);
  els.starSummary.textContent = t('meta.starred', { n: starred });
  els.gridLabel.textContent = state.starredOnly ? t('collection.starredLabel') : t('collection.label');
  els.starredFilter.setAttribute('aria-pressed', String(state.starredOnly));
}

function renderGrid() {
  const all = filteredProducts();
  const pages = Math.ceil(all.length / pageSize());
  if (state.page > pages) state.page = pages;
  if (state.page < 1) state.page = 1;

  const list = all.slice((state.page - 1) * pageSize(), state.page * pageSize());

  els.grid.innerHTML = '';

  if (!all.length) {
    els.empty.hidden = false;
    els.empty.textContent = state.starredOnly
      ? t('empty.starred')
      : state.category
        ? t('empty.category', { name: state.category })
        : t('empty.empty');
    return;
  }
  els.empty.hidden = true;

  list.forEach((product, index) => {
    const card = document.createElement('article');
    card.className = 'piece';
    const title = getLocalized(product, 'title');
    const series = getLocalized(product, 'series');
    card.dataset.id = product.id;
    card.style.animationDelay = `${Math.min(index * 55, 550)}ms`;
    card.innerHTML = `
      <button class="piece-media" type="button" data-open="${product.id}" aria-label="${t('piece.view')} ${escapeHtml(title)}">
        <img src="${escapeHtml(product.image)}" alt="${escapeHtml(title)}" loading="lazy" />
      </button>
      <div class="piece-meta">
        <div>
          <h3 class="piece-title">${escapeHtml(title)}</h3>
          <p class="piece-series">${escapeHtml(series || 'StarCull')}</p>
        </div>
        <div class="piece-actions">
          <button class="star${product.starred ? ' is-on' : ''}" type="button" data-star="${product.id}" aria-pressed="${product.starred}" aria-label="${t('piece.star')} ${escapeHtml(title)}">
            ${STAR_SVG}<span class="count">${product.count || ''}</span>
          </button>
          <button class="vote vote-like${product.liked ? ' is-on' : ''}" type="button" data-like="${product.id}" aria-pressed="${product.liked}" aria-label="${t('piece.like')}">
            ${LIKE_SVG}<span class="count">${product.likeCount || ''}</span>
          </button>
          <button class="vote vote-dislike${product.disliked ? ' is-on' : ''}" type="button" data-dislike="${product.id}" aria-pressed="${product.disliked}" aria-label="${t('piece.dislike')}">
            ${DISLIKE_SVG}<span class="count">${product.dislikeCount || ''}</span>
          </button>
        </div>
      </div>`;

    const img = $('img', card);
    const media = $('.piece-media', card);
    img.addEventListener('error', () => {
      img.remove();
      media.classList.add('missing');
      media.insertAdjacentHTML('beforeend', `<span class="media-missing">${escapeHtml(title)}</span>`);
    }, { once: true });

    els.grid.appendChild(card);
  });

  els.grid.style.paddingBottom = list.length ? '' : '0';
}

function syncVoteWidgets(id) {
  const product = productById(id);
  if (!product) return;
  $$(`.star[data-star="${id}"]`).forEach((btn) => {
    btn.classList.toggle('is-on', product.starred);
    btn.setAttribute('aria-pressed', String(product.starred));
    const count = $('.count', btn);
    if (count) count.textContent = product.count || '';
  });
  $$(`.vote-like[data-like="${id}"]`).forEach((btn) => {
    btn.classList.toggle('is-on', product.liked);
    btn.setAttribute('aria-pressed', String(product.liked));
    const count = $('.count', btn);
    if (count) count.textContent = product.likeCount || '';
  });
  $$(`.vote-dislike[data-dislike="${id}"]`).forEach((btn) => {
    btn.classList.toggle('is-on', product.disliked);
    btn.setAttribute('aria-pressed', String(product.disliked));
    const count = $('.count', btn);
    if (count) count.textContent = product.dislikeCount || '';
  });
  if (els.lightboxStar.dataset.id === id) {
    els.lightboxStar.setAttribute('aria-pressed', String(product.starred));
    els.lightboxStar.classList.toggle('is-on', product.starred);
    $('span', els.lightboxStar).textContent = product.starred ? t('piece.starred') : t('piece.star');
  }
  if (els.lightboxLike?.dataset.id === id) {
    els.lightboxLike.classList.toggle('is-on', product.liked);
    els.lightboxLike.setAttribute('aria-pressed', String(product.liked));
    $('.count', els.lightboxLike).textContent = product.likeCount || '';
  }
  if (els.lightboxDislike?.dataset.id === id) {
    els.lightboxDislike.classList.toggle('is-on', product.disliked);
    els.lightboxDislike.setAttribute('aria-pressed', String(product.disliked));
    $('.count', els.lightboxDislike).textContent = product.dislikeCount || '';
  }
}

function handleBonus(result) {
  if (result && typeof result.points === 'number') updatePoints(result.points);
  if (result && result.bonusPoints > 0) {
    toast(t('bonus.interaction', { n: result.bonusPoints }));
  }
}

async function toggleStar(id, btn) {
  const product = productById(id);
  if (!product) return;

  const wasStarred = product.starred;
  product.starred = !wasStarred;
  product.count += product.starred ? 1 : -1;

  if (btn) {
    btn.classList.remove('pop');
    void btn.offsetWidth;
    btn.classList.add('pop');
  }

  syncVoteWidgets(id);
  renderCounts();
  renderTray();

  try {
    const result = await api(`/api/products/${id}/star`, { method: 'POST' });
    product.starred = result.starred;
    product.count = result.count;
    syncVoteWidgets(id);
    renderCounts();
    renderTray();
    handleBonus(result);
    if (state.starredOnly) {
      renderGrid();
      renderPager();
    }
  } catch (error) {
    product.starred = wasStarred;
    product.count += wasStarred ? 1 : -1;
    syncVoteWidgets(id);
    renderCounts();
    renderTray();
    toast(error.message);
  }
}

async function toggleLike(id, btn) {
  const product = productById(id);
  if (!product) return;

  const wasLiked = product.liked;
  const wasDisliked = product.disliked;
  product.liked = !wasLiked;
  if (product.liked) {
    product.likeCount += 1;
    if (product.disliked) { product.disliked = false; product.dislikeCount -= 1; }
  } else {
    product.likeCount -= 1;
  }

  if (btn) {
    btn.classList.remove('pop');
    void btn.offsetWidth;
    btn.classList.add('pop');
  }

  syncVoteWidgets(id);

  try {
    const result = await api(`/api/products/${id}/like`, { method: 'POST' });
    product.liked = result.liked;
    product.disliked = result.disliked;
    product.likeCount = result.likeCount;
    product.dislikeCount = result.dislikeCount;
    syncVoteWidgets(id);
    handleBonus(result);
  } catch (error) {
    product.liked = wasLiked;
    product.disliked = wasDisliked;
    if (wasLiked) product.likeCount = Math.max(0, product.likeCount - 1); else product.likeCount += 1;
    if (wasDisliked) product.dislikeCount += 1; else product.dislikeCount = Math.max(0, product.dislikeCount - 1);
    syncVoteWidgets(id);
    toast(error.message);
  }
}

async function toggleDislike(id, btn) {
  const product = productById(id);
  if (!product) return;

  const wasDisliked = product.disliked;
  const wasLiked = product.liked;
  product.disliked = !wasDisliked;
  if (product.disliked) {
    product.dislikeCount += 1;
    if (product.liked) { product.liked = false; product.likeCount -= 1; }
  } else {
    product.dislikeCount -= 1;
  }

  if (btn) {
    btn.classList.remove('pop');
    void btn.offsetWidth;
    btn.classList.add('pop');
  }

  syncVoteWidgets(id);

  try {
    const result = await api(`/api/products/${id}/dislike`, { method: 'POST' });
    product.disliked = result.disliked;
    product.liked = result.liked;
    product.likeCount = result.likeCount;
    product.dislikeCount = result.dislikeCount;
    syncVoteWidgets(id);
    handleBonus(result);
  } catch (error) {
    product.disliked = wasDisliked;
    product.liked = wasLiked;
    if (wasDisliked) product.dislikeCount = Math.max(0, product.dislikeCount - 1); else product.dislikeCount += 1;
    if (wasLiked) product.likeCount += 1; else product.likeCount = Math.max(0, product.likeCount - 1);
    syncVoteWidgets(id);
    toast(error.message);
  }
}
