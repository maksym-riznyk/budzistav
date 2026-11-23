import { alternatives, canMerge, catalogMatcher, categories, decimal, groupOffers, indexSearch, quote, stockLabels, units, webUrl } from './model.js';
import { comparePhotos } from './photos.js';

const demo = document.documentElement.hasAttribute('data-demo') ? await import('./demo.js') : null;
const $ = (id) => document.getElementById(id);
const state = { sources: [], offers: [], decisions: {}, provider: 'off', selected: '', category: '', quantity: '', groups: [] };
const narrowCatalog = matchMedia('(max-width: 900px)');
const pageSize = () => narrowCatalog.matches ? 7 : 8;
const providerNames = { off: 'Вимкнено', codex: 'Codex CLI', claude: 'Claude Code' };
const statusNames = { ready: 'Готово', busy: 'Оновлюється', error: 'Потрібна увага' };
const selectorLabels = {
  name: 'Назва', price: 'Ціна', currency: 'Валюта', sku: 'Артикул', mpn: 'Код виробника',
  brand: 'Виробник', unit: 'Одиниця', pack: 'Обсяг упаковки', stock: 'Наявність', category: 'Категорія', image: 'Фото',
  description: 'Опис',
};
const format = new Intl.NumberFormat('uk-UA', { maximumFractionDigits: 2 });
const plurals = new Intl.PluralRules('uk');
const countOf = (count, one, few, many) => format.format(count) + ' ' + ({ one, few }[plurals.select(count)] || many);
const dateFormat = new Intl.DateTimeFormat('uk-UA', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const market = (id) => state.sources.find((source) => source.id === id);
const current = () => state.groups.find((group) => group.id === state.selected);
const moneyFormat = new Intl.NumberFormat('uk-UA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const price = (value, currency) => `${(Number.isInteger(value) ? format : moneyFormat).format(value)} ${currency === 'UAH' ? '₴' : currency || ''}`.trim();
const unitPrice = (offer) => offer.price > 0 && !offer.priceSaved && offer.pack && offer.currency ? offer.price / offer.pack : Infinity;
const bestOffer = (offers) => offers.filter((offer) => offer.stock === 'in' && Number.isFinite(unitPrice(offer)))
  .sort((a, b) => unitPrice(a) - unitPrice(b))[0];
let sourceEdit = null;
let webProduct = '';
let storeProduct = '';
let storeSearchController;
let storePreview;
let storeRenderFrame;
let storeLimit = 24;
let noticeTimer;
let pollTimer;
let catalogPage = 0;
let catalogFrame = 0;
let catalogAlternatives = new WeakMap();
let catalogPosition = { top: 0 };
let bulkRefresh = false;
let availabilityTimer;
const refreshingProducts = new Set();
let catalogTimer;

function element(tag, className, ...children) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  node.append(...children.filter((child) => child !== null && child !== undefined));
  return node;
}

function button(label, className, action) {
  const node = element('button', className, label);
  node.type = 'button';
  node.addEventListener('click', action);
  return node;
}

function link(label, address, className = 'subtle-link') {
  const node = element('a', className, label);
  node.href = address;
  node.target = '_blank';
  node.rel = 'noopener noreferrer';
  return node;
}

function thumb(offer, related = []) {
  const placeholder = element('span', 'thumb', '▧');
  placeholder.setAttribute('aria-hidden', 'true');
  if (offer.tile !== null && offer.tile !== undefined) {
    placeholder.textContent = '';
    placeholder.classList.add('tile', `tile-${offer.tile}`);
    return placeholder;
  }
  const urls = [...new Set([offer, ...related].flatMap((item) => item.images?.length ? item.images : [item.image])
    .map((address) => webUrl(address)).filter(Boolean))].slice(0, 5);
  if (!urls.length) return placeholder;

  const image = element('img');
  image.alt = '';
  image.loading = 'lazy';
  image.referrerPolicy = 'no-referrer';
  const preview = button('', 'thumb photo-trigger', () => openPhoto(offer.name, image.src));
  preview.disabled = true;
  preview.setAttribute('aria-label', `Збільшити фото: ${offer.name}`);
  preview.setAttribute('aria-haspopup', 'dialog');
  preview.replaceChildren(image);
  let index = 0;
  const load = () => { image.src = demo ? urls[index] : '/api/image?url=' + encodeURIComponent(urls[index]); };
  image.addEventListener('load', () => { preview.disabled = false; });
  image.addEventListener('error', () => {
    index += 1;
    if (index < urls.length) load();
    else preview.replaceWith(placeholder);
  });
  load();
  return preview;
}

function openPhoto(name, src) {
  const image = element('img');
  image.alt = name;
  image.referrerPolicy = 'no-referrer';
  image.hidden = true;
  const status = element('p', 'item-meta', 'Завантажуємо фото…');
  status.setAttribute('role', 'status');
  image.addEventListener('load', () => {
    image.hidden = false;
    status.hidden = true;
  });
  image.addEventListener('error', () => { status.textContent = 'Не вдалося завантажити фото.'; });
  $('photo-title').textContent = name;
  $('photo-content').replaceChildren(image, status);
  image.src = src;
  $('photo-dialog').showModal();
}

function notice(message, error = false) {
  clearTimeout(noticeTimer);
  const node = $('notice');
  node.textContent = message;
  node.classList.toggle('error', error);
  node.hidden = !message;
  if (message && !error) noticeTimer = setTimeout(() => { node.hidden = true; }, 5500);
}

function formError(id, error) {
  $(id).textContent = error?.message || '';
  $(id).hidden = !error;
}

async function api(path, data, method = data === undefined ? 'GET' : 'POST') {
  const response = await fetch(path, { method, ...(data !== undefined ? {
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
  } : {}) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Не вдалося виконати дію.');
  return result;
}

function option(value, title) {
  const opt = element('option', '', title);
  opt.value = value;
  return opt;
}

function offersFromSource(offers, filter) {
  return filter ? offers.filter((offer) => offer.sourceId === filter) : offers;
}

function catalogOffers(offers, source = $('source-filter').value, inStock = $('stock-filter').checked) {
  return offers.filter((offer) => (!source || offer.sourceId === source) && (!inStock || offer.stock === 'in'));
}

function filteredGroups() {
  const matches = catalogMatcher($('search').value);
  const source = $('source-filter').value;
  const inStock = $('stock-filter').checked;
  return state.groups.flatMap((group) => {
    if (state.category && group.product.category !== state.category) return [];
    const offers = catalogOffers(group.offers, source, inStock);
    return offers.length && (matches(group.product) || offers.some(matches)) ? [{ ...group, offers }] : [];
  });
}

function updateExport(product) {
  const params = new URLSearchParams();
  if (product) {
    params.set('product', product.id);
    if (decimal(state.quantity) > 0) params.set('quantity', decimal(state.quantity));
  }
  if ($('search').value) params.set('q', $('search').value);
  if (state.category) params.set('category', state.category);
  if ($('source-filter').value) params.set('source', $('source-filter').value);
  if ($('stock-filter').checked) params.set('stock', 'in');
  if (product) return '/api/export?' + params;
  $('download').href = '/api/export?' + params;
}

function openProductView(row) {
  if (!narrowCatalog.matches) return;
  const page = $('catalog-page');
  if (!page.classList.contains('show-product')) {
    catalogPosition = { top: window.scrollY, rowTop: row?.getBoundingClientRect().top };
  }
  page.classList.add('show-product');
  $('catalog-back').focus({ preventScroll: true });
  window.scrollTo({ top: 0, behavior: 'instant' });
}

function returnToCatalog() {
  const page = $('catalog-page');
  page.classList.remove('show-product');
  const row = $('products').querySelector('[aria-pressed="true"]');
  row?.focus({ preventScroll: true });
  requestAnimationFrame(() => {
    if (page.hidden || page.classList.contains('show-product')) return;
    const top = row?.isConnected && catalogPosition.rowTop !== undefined
      ? window.scrollY + row.getBoundingClientRect().top - catalogPosition.rowTop : catalogPosition.top;
    window.scrollTo({ top, behavior: 'instant' });
  });
}

function renderPagination(lastPage) {
  function changePage(step) {
    catalogPage += step;
    renderProducts();
    $('products').scrollTop = 0;
    if (narrowCatalog.matches) $('catalog-list').scrollIntoView({ block: 'start' });
    const controls = [...$('pagination').querySelectorAll('button')];
    const preferred = controls[step < 0 ? 0 : 1];
    if (!narrowCatalog.matches) (preferred.disabled ? controls.find((item) => !item.disabled) : preferred)?.focus({ preventScroll: true });
  }
  const nav = $('pagination');
  nav.hidden = lastPage === 0;
  if (!lastPage) return;
  const prev = button('←', 'button secondary', () => changePage(-1));
  const next = button('→', 'button secondary', () => changePage(1));
  prev.setAttribute('aria-label', 'Попередня сторінка');
  next.setAttribute('aria-label', 'Наступна сторінка');
  prev.disabled = catalogPage === 0;
  next.disabled = catalogPage === lastPage;
  const position = element('span', '', [catalogPage + 1, lastPage + 1].join(' / '));
  position.setAttribute('aria-live', 'polite');
  nav.replaceChildren(prev, position, next);
}

function renderProducts() {
  const groups = filteredGroups();
  const size = pageSize();
  const lastPage = Math.max(0, Math.ceil(groups.length / size) - 1);
  catalogPage = Math.min(catalogPage, lastPage);
  const visible = groups.slice(catalogPage * size, (catalogPage + 1) * size);
  if (!visible.some(({ id }) => id === state.selected)) {
    state.selected = visible[0]?.id || '';
    state.quantity = visible[0]?.product.pack ? String(visible[0].product.pack) : '';
  }
  const filter = $('source-filter').value;
  const total = state.groups.filter((group) => offersFromSource(group.offers, filter).length).length;
  $('product-count').textContent = groups.length === total ? format.format(total) : format.format(groups.length) + ' / ' + format.format(total);
  $('products').replaceChildren(...(visible.length ? visible.map((group) => {
    const { product, offers } = group;
    const best = bestOffer(offers);
    const label = element('span', '',
      element('span', 'item-title', product.name),
      element('span', 'item-meta', [product.brand, product.dimensions].filter(Boolean).join(' / ') || product.sku));
    const single = !best && offers.length === 1 && offers[0].price > 0 && !offers[0].priceSaved && offers[0].currency ? offers[0] : null;
    const cost = element('span', 'price-cell', best ? price(unitPrice(best), best.currency)
      : single ? price(single.price, single.currency) : '—',
    best ? element('small', '', 'за ' + best.unit) : single ? element('small', '', 'ціна магазину') : null);
    const select = button('', 'product-select', () => {
      state.selected = group.id;
      state.quantity = product.pack ? String(product.pack) : '';
      $('products').querySelector('.product-select[aria-pressed="true"]')?.setAttribute('aria-pressed', 'false');
      select.setAttribute('aria-pressed', 'true');
      renderDetail();
      openProductView(select);
    });
    select.replaceChildren(label, element('span', 'offer-count', offers.length), cost);
    select.setAttribute('aria-pressed', String(group.id === state.selected));
    return element('div', 'product-row', thumb(product, offers), select);
  }) : [element('p', 'empty', state.groups.length ? 'Товарів за цими фільтрами немає.' : 'Додайте товар за посиланням або завантажте прайс.')]));
  renderPagination(lastPage);
  renderDetail();
  if (!demo) updateExport();
}

function renderDetail() {
  const group = current();
  const detail = $('product-detail');
  if (!group) {
    detail.replaceChildren(element('p', 'empty', 'Виберіть товар у каталозі.'));
    return;
  }
  const { product } = group;
  const stores = new Set(catalogOffers(group.offers).map(({ sourceId }) => sourceId)).size;
  const detailMeta = [product.brand, product.mpn, product.dimensions, countOf(stores, 'магазин', 'магазини', 'магазинів')];
  const heading = element('div', 'detail-heading', thumb(product, group.offers), element('div', '',
    element('h2', '', product.name),
    element('span', 'item-meta', detailMeta.filter(Boolean).join(' · '))));
  const qty = element('input');
  qty.type = 'number';
  qty.min = '0.001';
  qty.max = '100000';
  qty.step = 'any';
  qty.value = state.quantity;
  if (!catalogAlternatives.has(product)) catalogAlternatives.set(product, alternatives(product, state.groups));
  const busy = refreshingProducts.has(group.id);
  const refresh = !demo && state.sources.some(({ kind }) => kind === 'web')
    ? button(busy ? 'Оновлюємо…' : 'Оновити', 'button secondary', () => refreshPrices(group.id)) : null;
  if (refresh) {
    refresh.disabled = busy || bulkRefresh;
    refresh.setAttribute('aria-label', 'Оновити наявність');
  }
  const tools = element('div', 'detail-tools',
    product.unit ? element('label', '', 'Обсяг, ' + product.unit, qty) : element('p', 'item-meta', 'Ціна магазину'),
    demo ? null : element('div', 'offer-actions',
      button('Шукати в магазинах', 'button primary', () => openStoreSearch(product.name, group.id)), refresh));
  qty.setAttribute('aria-label', `Потрібно, ${product.unit}`);
  const list = element('div', 'offers');
  const exportLink = element('a', 'subtle-link', 'Експорт товару');
  if (demo) {
    exportLink.href = './';
    exportLink.addEventListener('click', (event) => demo.downloadCsv(event,
      [{ ...group, offers: catalogOffers(group.offers) }], state.sources, decimal(state.quantity)));
  } else exportLink.href = updateExport(group);
  const footer = element('div', 'detail-footer', exportLink,
    catalogAlternatives.get(product).length ? button('Порівняти аналоги', 'plain', () => openCompare(group.id)) : null,
    state.provider !== 'off' ? button('Пошук з ШІ', 'plain', () => openWeb(product.name, group.id)) : null);
  qty.addEventListener('input', () => {
    state.quantity = qty.value;
    renderOffers(list, group);
    if (!demo) exportLink.href = updateExport(group);
  });
  detail.replaceChildren(heading, tools, list, footer);
  renderOffers(list, group);
}

const descriptionHeadings = /^(?:Опис|Характеристики|Застосування|Властивості|Технічні характеристики)$/iu;
const descriptionLabels = /(?:Склад|Фасування|Фасовка|Термін придатності|Час коригування|Відкритий час|Температура застосування|Заповнення швів|Витрата води[^:\n]{0,70}):/u.source;
const inlineDescriptionLabel = new RegExp(`\\s+(?=${descriptionLabels})`, 'gu');
const openingDescriptionLabel = new RegExp(`^(${descriptionLabels})\\s*(.*)$`, 'u');
const sentences = new Intl.Segmenter('uk', { granularity: 'sentence' });

function descriptionButton(offer, supplier) {
  if (!offer.description) return null;
  const trigger = button('Опис', 'plain description-link', () => {
    $('description-title').textContent = supplier;
    const text = offer.description.trim();
    const title = offer.name;
    const body = text.toLocaleLowerCase('uk').startsWith(title.toLocaleLowerCase('uk') + ' ')
      ? text.slice(title.length).trim() : text;
    const lines = body.replace(/\s+(Характеристики|Технічні характеристики|Застосування|Властивості)(?=\s)/gu, '\n$1\n')
      .replace(inlineDescriptionLabel, '\n')
      .split(/\n+/).map((line) => line.trim()).filter(Boolean);
    const blocks = lines.flatMap((line) => {
      if (descriptionHeadings.test(line)) return [element('h3', '', line)];
      const label = line.match(openingDescriptionLabel);
      if (label) return [element('p', '', element('strong', '', label[1]), ' ' + label[2])];
      const paragraphs = [];
      let paragraph = '';
      for (const { segment } of sentences.segment(line)) {
        paragraph += segment;
        if (paragraph.length >= 250) {
          paragraphs.push(element('p', '', paragraph.trim()));
          paragraph = '';
        }
      }
      if (paragraph.trim()) paragraphs.push(element('p', '', paragraph.trim()));
      return paragraphs;
    });
    const meta = [offer.sku && 'Артикул ' + offer.sku, offer.origin, offer.observedAt && dateFormat.format(new Date(offer.observedAt))]
      .filter(Boolean).join(' · ');
    const content = $('description-content');
    content.replaceChildren(element('div', 'description-copy', element('h3', 'description-product', title),
      meta ? element('p', 'item-meta', meta) : null, ...blocks,
      offer.url ? link('Сторінка товару', offer.url) : null));
    $('description-dialog').showModal();
    content.scrollTop = 0;
  });
  trigger.setAttribute('aria-label', 'Опис товару · ' + supplier);
  return trigger;
}

function renderOffers(container, group) {
  const quantity = decimal(state.quantity);
  const filtered = catalogOffers(group.offers);
  const offers = filtered.map((offer) => ({ offer, order: quote(offer, quantity) }));
  offers.sort((a, b) => Number(b.offer.stock === 'in') - Number(a.offer.stock === 'in')
    || (a.order?.total ?? unitPrice(a.offer)) - (b.order?.total ?? unitPrice(b.offer)));
  const best = offers.find(({ offer, order }) => offer.stock === 'in' && order && offer.currency);
  const headers = ['Магазин', 'Ціна', 'Наявність'].map((name) => {
    const cell = element('th', '', name);
    cell.scope = 'col';
    return cell;
  });
  const items = offers.map((entry) => {
    const { offer, order } = entry;
    const perUnit = offer.priceSaved ? 'Збережена ціна' : offer.pack && offer.currency && offer.price > 0
      ? `${price(offer.price / offer.pack, offer.currency)} / ${offer.unit}` : '';
    const shown = order ? price(order.total, offer.currency) : offer.price > 0 ? price(offer.price, offer.currency) : '—';
    const packaging = order ? `${format.format(order.packs)} уп. · ${format.format(order.quantity)} ${offer.unit}`
      : (offer.pack ? `${format.format(offer.pack)} ${offer.unit} / уп.` : '');
    const source = market(offer.sourceId);
    const name = source?.name || 'Постачальник';
    const sourceName = offer.url ? link(name, offer.url, 'supplier') : element('span', 'supplier', name);
    const shop = element('th', 'offer-shop', sourceName,
      element('span', 'offer-meta', packaging ? element('span', '', packaging) : null, descriptionButton(offer, name)),
      state.decisions[offer.id] ? button('Скасувати зіставлення', 'plain', () => changeMatch(offer.id, null)) : null);
    shop.scope = 'row';
    return element('tr', 'offer', shop, element('td', 'offer-cost',
      element('strong', 'offer-price' + (best === entry ? ' best-price' : ''), shown),
      element('small', '', perUnit)), element('td', 'offer-stock',
      element('span', 'badge ' + offer.stock, stockLabels[offer.stock]),
      element('small', '', dateFormat.format(new Date(offer.observedAt)))));
  });
  const table = element('table', 'offer-table',
    element('colgroup', '', element('col'), element('col', 'offer-col-price'), element('col', 'offer-col-stock')),
    element('thead', '', element('tr', '', ...headers)), element('tbody', '', ...items));
  table.setAttribute('aria-label', 'Пропозиції магазинів');
  container.replaceChildren(table);
}

function renderCategories() {
  $('categories').replaceChildren(...['', ...categories.filter((category) => state.groups.some(({ product }) => product.category === category))]
    .map((category) => {
      const pill = button(category || 'Усі категорії', '', () => {
        state.category = category;
        catalogPage = 0;
        for (const chip of $('categories').children) chip.setAttribute('aria-pressed', String(chip === pill));
        renderProducts();
      });
      pill.setAttribute('aria-pressed', String(state.category === category));
      return pill;
    }));
}

function renderSources() {
  $('sources-refresh').disabled = !bulkRefresh && !state.sources.some(({ kind }) => kind === 'web');
  $('sources-refresh').textContent = bulkRefresh ? 'Перебіг оновлення' : 'Оновити всі';
  const counts = new Map();
  for (const offer of state.offers) {
    const count = counts.get(offer.sourceId) ?? { total: 0, unit: 0, stock: 0 };
    count.total += 1;
    count.unit += Number(Boolean(offer.pack && offer.currency));
    count.stock += Number(offer.stock !== 'unknown');
    counts.set(offer.sourceId, count);
  }
  $('sources').replaceChildren(...(state.sources.length ? state.sources.map((source) => {
    const status = source.status ?? {};
    const busy = status.state === 'busy';
    const method = source.kind === 'csv' || source.method === 'csv'
      ? 'Прайс CSV' : source.method === 'feed' ? 'Фід XML' : 'Вебсайт';
    const count = counts.get(source.id);
    const details = source.url ? element('p', '', link(new URL(source.url).hostname, source.url)) : null;
    const updated = status.observedAt ? dateFormat.format(new Date(status.observedAt)) : '';
    const note = [status.note, status.skipped ? `Пропущено: ${status.skipped}` : ''].filter(Boolean).join(' ');
    const controls = element('div', 'source-actions local-only',
      source.kind === 'web' ? button('Оновити', 'button secondary', () => refreshSource(source.id)) : null,
      source.kind === 'web' ? button('Правила', 'button secondary', () => openSource(source)) : null,
      source.kind === 'web' && state.provider !== 'off' ? button('Налаштувати з ШІ', 'button secondary', () => refreshSource(source.id, true)) : null,
      source.kind === 'csv' ? button('Замінити прайс', 'button secondary', () => openSource(source)) : null,
      button('Видалити', 'button secondary danger', () => deleteSource(source)));
    for (const control of controls.children) control.disabled = busy;
    return element('article', 'source-row',
      element('div', '', element('h3', '', source.name), details),
      element('div', 'method', method, element('p', '', `Пропозицій: ${count?.total ?? 0}`),
        count ? element('p', '', `Ціна за одиницю ${count.unit}/${count.total} · Наявність ${count.stock}/${count.total}`) : null),
      element('div', '', element('span', 'badge ' + status.state, statusNames[status.state] || 'Очікує'),
        updated ? element('p', '', updated) : null, source.aiConfigured ? element('p', '', 'Правила налаштовано з ШІ') : null),
      controls, note ? element('p', 'status-note', note) : null);
  }) : [element('p', 'empty', 'Додайте сайт, фід або прайс постачальника.')]));
}

async function reload() {
  clearTimeout(pollTimer);
  Object.assign(state, await (demo ? demo.loadCatalog() : api('/api/state')));
  const filter = $('source-filter');
  const old = filter.value;
  filter.replaceChildren(option('', 'Усі джерела'), ...state.sources.map((source) => option(source.id, source.name)));
  filter.value = state.sources.some(({ id }) => id === old) ? old : '';
  state.groups = groupOffers(state.offers, state.decisions);
  catalogAlternatives = new WeakMap();
  for (const group of state.groups) {
    indexSearch(group.product);
    for (const offer of group.offers) indexSearch(offer);
  }
  if (!state.groups.some(({ product }) => product.category === state.category)) state.category = '';
  $('nav-count').textContent = state.sources.length;
  $('cli-status').textContent = providerNames[state.provider];
  document.querySelector('.connection-dot').classList.toggle('connected', state.provider !== 'off');
  renderCategories();
  renderProducts();
  renderSources();
  if (!demo && state.sources.some(({ status }) => status?.state === 'busy')) {
    pollTimer = setTimeout(() => reload().catch((error) => notice(error.message, true)), 1400);
  }
}

function navigate(page) {
  const catalog = page === 'catalog';
  if (catalog && !$('catalog-page').hidden && narrowCatalog.matches && $('catalog-page').classList.contains('show-product')) {
    returnToCatalog();
    return;
  }
  if ($('catalog-page').hidden === catalog) window.scrollTo({ top: 0 });
  $('catalog-page').classList.remove('show-product');
  $('title').textContent = catalog ? 'Порівняння товарів' : 'Джерела';
  $('catalog-page').hidden = !catalog;
  $('sources-page').hidden = catalog;
  $('download').hidden = !catalog;
  $('product-new').hidden = !catalog;
  $('source-new').hidden = catalog;
  $('catalog-tab').removeAttribute('aria-current');
  $('sources-tab').removeAttribute('aria-current');
  $(catalog ? 'catalog-tab' : 'sources-tab').setAttribute('aria-current', 'page');
}

function toggleSourceFields() {
  const fields = $('source-form').elements;
  const isCsv = fields.kind.value === 'csv';
  $('file-field').hidden = !isCsv;
  $('url-field').hidden = isCsv;
  $('recipe-fields').hidden = isCsv;
  fields.file.required = isCsv;
  fields.url.required = !isCsv;
}

function openSource(source = null) {
  sourceEdit = source;
  const form = $('source-form');
  const fields = form.elements;
  form.reset();
  formError('source-error');
  $('recipe-fields').open = !!source && source.kind === 'web';
  fields.name.value = source?.name || '';
  fields.kind.value = source?.kind || 'web';
  fields.name.disabled = source?.kind === 'csv';
  fields.kind.disabled = !!source;
  fields.url.value = source?.url || '';
  fields.url.readOnly = !!source;
  fields.limit.value = source?.limit || 24;
  fields.prefix.value = source?.recipe?.prefix || '';
  fields.defaultUnit.value = source?.recipe?.defaults?.unit || '';
  fields.defaultPack.value = source?.recipe?.defaults?.pack || '';
  fields.defaultCurrency.value = source?.recipe?.defaults?.currency || '';
  fields.titleWeight.checked = Boolean(source?.recipe?.defaults?.titleWeight);
  fields.productPages.value = source?.productPages?.join('\n') || '';
  for (const field of Object.keys(selectorLabels)) fields[`selector-${field}`].value = source?.recipe?.selectors?.[field] || '';
  const label = source ? source.kind === 'csv' ? 'Замінити прайс' : 'Правила збору' : 'Додати джерело';
  $('source-title').textContent = label;
  $('source-submit').textContent = source ? 'Зберегти й оновити' : label;
  toggleSourceFields();
  $('source-dialog').showModal();
}

async function refreshSource(id, configure = false) {
  try {
    await api(`/api/sources/${id}/refresh`, { configure });
    await reload();
  } catch (error) { notice(error.message, true); }
}

async function refreshAllSources() {
  showAvailability();
  if (bulkRefresh) return;
  $('sources-refresh').disabled = true;
  try {
    renderAvailability(await api('/api/availability-run', {}));
    await monitorAvailability(true);
  } catch (error) {
    availabilityError(error);
  } finally {
    renderSources();
  }
}

async function refreshPrices(productId) {
  if (refreshingProducts.size || bulkRefresh) return;
  refreshingProducts.add(productId);
  renderDetail();
  showAvailability();
  try {
    renderAvailability(await api('/api/products/refresh', { productId }));
    await reload();
  } catch (error) {
    availabilityError(error);
  } finally {
    refreshingProducts.delete(productId);
    renderDetail();
  }
}

function showAvailability() {
  const dialog = $('availability-dialog');
  if (dialog.open) return;
  if (!bulkRefresh) $('availability-report').textContent = 'Перевіряємо магазини…';
  dialog.showModal();
}

function availabilityError(error) {
  $('availability-report').replaceChildren(element('p', 'form-error', error.message));
}

function renderAvailability(run) {
  const stages = { running: 'Перевіряємо магазини…', ready: 'Перевірку завершено',
    partial: 'Перевірку завершено частково', interrupted: 'Оновлення перервано' };
  const states = { running: 'Перевіряємо', checked: 'Перевірено', partial: 'Частково перевірено', error: 'Недоступний' };
  const total = (field) => run.sources.reduce((sum, row) => sum + row[field], 0);
  const progress = element('progress');
  progress.max = Math.max(1, total('total'));
  progress.value = total('checked');
  progress.setAttribute('aria-label', 'Перевірка карток');
  const checked = run.sources.filter(({ state }) => state === 'checked').length;
  const report = element('div', 'catalog-report',
    element('strong', '', stages[run.state]),
    element('p', '', `Магазинів перевірено ${checked} з ${run.sources.length} · Товарів ${format.format(run.products)}`),
    element('p', '', `Оновлено ${total('updated')} · Додано ${total('added')} · Змін наявності ${total('changed')}`),
    total('unknown') ? element('p', 'item-meta', `Наявність не вказано для ${total('unknown')} пропозицій`) : null,
    run.state === 'running' ? progress : null);
  for (const row of run.sources) {
    const status = run.state === 'interrupted' && row.state === 'running' ? 'Перервано' : states[row.state];
    report.append(element('div', 'catalog-source', element('strong', '', row.name),
      element('span', '', [status, countOf(row.checked, 'картка', 'картки', 'карток'),
        countOf(row.updated + row.added, 'пропозиція', 'пропозиції', 'пропозицій')].join(' · ')),
      row.warnings.length ? element('span', 'availability-warning', row.warnings.join(' ')) : null));
  }
  $('availability-report').replaceChildren(report);
}

async function monitorAvailability(wasRunning = false) {
  clearTimeout(availabilityTimer);
  try {
    const run = await api('/api/availability-run');
    bulkRefresh = run.state === 'running';
    if ((bulkRefresh || wasRunning) && run.state) renderAvailability(run);
    if (bulkRefresh) availabilityTimer = setTimeout(() => monitorAvailability(true), 1600);
    else if (wasRunning) await reload();
  } catch (error) {
    if (wasRunning) {
      availabilityError(error);
      availabilityTimer = setTimeout(() => monitorAvailability(true), 4000);
    }
  } finally {
    renderSources();
  }
}

function openProduct(url = '') {
  $('product-form').elements.url.value = url;
  formError('product-error');
  $('product-dialog').showModal();
}

async function deleteSource(source) {
  if (!window.confirm(`Видалити «${source.name}» разом із пропозиціями?`)) return;
  try {
    await api('/api/sources/' + source.id, undefined, 'DELETE');
    await reload();
    notice('Джерело видалено.');
  } catch (error) { notice(error.message, true); }
}

async function changeMatch(offerId, productId) {
  try {
    await api('/api/match', { offerId, productId });
    await reload();
    notice(productId ? 'Пропозицію додано до товару.' : 'Зіставлення скасовано.');
    return true;
  } catch (error) {
    notice(error.message, true);
    return false;
  }
}

function compareCard(group) {
  const { product, offers } = group;
  const top = bestOffer(offers);
  const quantity = decimal(state.quantity);
  const total = Math.min(...offers.filter(({ stock }) => stock === 'in')
    .map((offer) => quote(offer, quantity)?.total ?? Infinity));
  const details = [
    ['Виробник', product.brand], ['Код виробника', product.mpn], ['Розміри', product.dimensions],
    ['Одиниця', product.unit], ['Пропозиції', offers.length], ['Ціна від', top ? price(unitPrice(top), top.currency) + ' / ' + top.unit : '—'],
  ];
  if (product.currency && Number.isFinite(total)) details.push([`За ${format.format(quantity)} ${product.unit}`, price(total, product.currency)]);
  return element('article', 'compare-box', thumb(product), element('h3', '', product.name),
    element('dl', '', ...details.map(([key, value]) => element('div', '', element('dt', '', key), element('dd', '', value || '—')))));
}

function openCompare(productId) {
  const group = state.groups.find(({ id }) => id === productId);
  const matches = alternatives(group.product, state.groups);
  if (!matches.length) return;
  const choose = element('select');
  choose.setAttribute('aria-label', 'Аналог');
  choose.append(...matches.map(({ id, product }) => option(id, product.name)));
  const comparison = element('div', 'compare-grid');
  const matchLine = element('div', 'match-line');
  const photoMatch = element('p', 'photo-match', 'Фото схожі');
  const similarPhotos = new Set();
  photoMatch.hidden = true;
  function compare() {
    const other = matches.find(({ id }) => id === choose.value);
    const compatible = demo ? [] : other.offers.filter((offer) => canMerge(offer, group.product));
    photoMatch.hidden = !similarPhotos.has(other.id);
    comparison.replaceChildren(compareCard(group), compareCard(other));
    const offers = element('select');
    offers.setAttribute('aria-label', 'Пропозиція для зіставлення');
    offers.append(...compatible.map((offer) => option(offer.id, [market(offer.sourceId)?.name, offer.sku].filter(Boolean).join(' / '))));
    matchLine.replaceChildren(...(!compatible.length ? [] : [offers, button('Це той самий товар', 'button secondary', async () => {
      if (!window.confirm('Підтвердити, що вибрана пропозиція стосується того самого товару?')) return;
      if (await changeMatch(offers.value, group.id)) $('compare-dialog').close();
    })]));
  }
  choose.addEventListener('change', compare);
  $('comparison').replaceChildren(choose, comparison, photoMatch, matchLine);
  compare();
  $('compare-dialog').showModal();
  if (!demo && group.product.image) void Promise.all(matches.map(async (candidate) => {
    if (await comparePhotos(group.product.image, candidate.product.image)) similarPhotos.add(candidate.id);
  })).then(() => {
    if (choose.isConnected) photoMatch.hidden = !similarPhotos.has(choose.value);
  });
}

function openWeb(query = '', productId = '') {
  if (state.provider === 'off') {
    openCli();
    return;
  }
  webProduct = productId;
  $('web-form').elements.query.value = query;
  $('web-results').replaceChildren();
  $('web-dialog').showModal();
}

function openStoreSearch(query = '', productId = '') {
  const form = $('store-form');
  const submit = form.querySelector('button[type="submit"]');
  const term = query.trim();
  storeSearchController?.abort();
  storePreview = null;
  storeProduct = productId;
  form.elements.query.value = term;
  $('store-results').replaceChildren();
  $('store-dialog').showModal();
  if (term) form.requestSubmit(submit);
}

function renderStoreSearch(result) {
  const status = { checked: 'Перевірено', checking: 'Перевіряємо', partial: 'Частково перевірено',
    busy: 'Оновлюється', error: 'Недоступний', catalog: 'Збережені дані' };
  const checked = result.sources.filter(({ state }) => state === 'checked').length;
  const target = $('store-results');
  const coverage = element('details', 'store-coverage',
    element('summary', '', element('span', '', 'Стан магазинів'),
      element('span', 'store-check-count', result.checking ? `Перевіряємо · ${checked} з ${result.sources.length}`
        : `${checked} із ${result.sources.length} перевірено`)));
  coverage.open = target.querySelector('.store-coverage')?.open || false;
  const sourceList = element('div', 'store-source-list');
  for (const source of result.sources) {
    sourceList.append(element('div', 'catalog-source', element('strong', '', source.name),
      element('span', '', `${status[source.state]} · ${source.count} пропозицій`),
      source.warning ? element('span', '', source.warning) : null));
  }
  coverage.append(sourceList);
  const groups = result.groups
    .sort((a, b) => Number(b.offers.some((quote) => quote.stock === 'in')) - Number(a.offers.some((quote) => quote.stock === 'in'))
      || b.offers.length - a.offers.length);
  const columns = element('colgroup', '', element('col'), element('col', 'store-col-price'), element('col', 'store-col-stock'));
  const headers = ['Магазин', 'Ціна', 'Наявність'].map((label) => {
    const header = element('th', '', label);
    header.scope = 'col';
    return header;
  });
  const table = element('table', 'store-table', columns, element('thead', '', element('tr', '', ...headers)));
  table.setAttribute('aria-label', 'Пропозиції магазинів');
  for (const { product, offers } of groups.slice(0, storeLimit)) {
    const heading = element('th', '', element('h3', '', product.name));
    heading.colSpan = 3;
    heading.scope = 'rowgroup';
    const rows = offers.sort((a, b) => Number(b.stock === 'in') - Number(a.stock === 'in')
      || (a.price ?? Infinity) - (b.price ?? Infinity))
      .map((offer) => {
        const name = market(offer.sourceId)?.name || 'Магазин';
        const shop = element('th', '', offer.url ? link(name, offer.url) : name);
        shop.scope = 'row';
        const currency = offer.currency === 'UAH' ? '₴' : offer.currency;
        const amount = offer.price > 0 ? [moneyFormat.format(offer.price), currency].filter(Boolean).join(' ') : '—';
        const cost = element('td', 'store-price', element('strong', '', amount),
          offer.pack ? element('small', '', `за ${format.format(offer.pack)} ${offer.unit}`) : null,
          offer.price > 0 && (offer.saved || offer.priceSaved) ? element('small', '', 'Збережена ціна') : null);
        const description = descriptionButton(offer, name);
        if (description) shop.append(' ', description);
        return element('tr', 'store-quote', shop, cost,
          element('td', 'store-stock', element('span', 'badge ' + offer.stock, stockLabels[offer.stock])));
      });
    table.append(element('tbody', 'store-group', element('tr', 'store-product', heading), ...rows));
  }
  target.replaceChildren(
    ...(result.resolved ? [element('p', 'store-resolved', result.resolved)] : []),
    ...(result.error ? [element('p', 'store-search-message form-error', result.error)] : []),
    coverage, groups.length ? table : element('p', 'store-search-message',
      result.checking ? 'Шукаємо пропозиції…' : 'За цим запитом товарів не знайдено.'),
    ...(groups.length > storeLimit ? [button('Більше результатів', 'button secondary store-more', () => {
      storeLimit += 24;
      queueStoreResults();
    })] : []),
  );
}

function queueStoreResults() {
  if (storeRenderFrame || !storePreview || !$('store-dialog').open || $('description-dialog').open) return;
  storeRenderFrame = requestAnimationFrame(() => {
    storeRenderFrame = 0;
    if (!storePreview || !$('store-dialog').open || $('description-dialog').open) return;
    const sources = [...storePreview.sources.values()];
    renderStoreSearch({ ...storePreview, sources: sources.map((source) => ({ ...source, count: source.offers.length })),
      groups: groupOffers(sources.flatMap(({ offers }) => offers)) });
  });
}

async function readStoreSearch(query, productId, controller) {
  const response = await fetch('/api/store-search', {
    method: 'POST', signal: controller.signal, headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, productId, stream: true }),
  });
  controller.signal.throwIfAborted();
  if (!response.ok) throw new Error((await response.json()).error);
  const preview = { resolved: '', sources: new Map(), checking: true };
  storePreview = preview;
  let buffer = '';
  for await (const chunk of response.body.pipeThrough(new TextDecoderStream())) {
    buffer += chunk;
    let end = buffer.indexOf('\n');
    while (end >= 0) {
      const event = JSON.parse(buffer.slice(0, end));
      buffer = buffer.slice(end + 1);
      end = buffer.indexOf('\n');
      if (event.error) throw new Error(event.error);
      if (event.sources) {
        preview.resolved = event.resolved;
        preview.sources = new Map(event.sources.map((source) => [source.sourceId, source]));
      }
      if (event.source) preview.sources.set(event.source.sourceId, event.source);
      if (event.done) {
        preview.checking = false;
        for (const { sourceId, state, warning } of event.sourceStatus) Object.assign(preview.sources.get(sourceId), { state, warning });
        queueStoreResults();
        return event.added;
      }
    }
    queueStoreResults();
  }
  throw new Error('Пошук перервано. Спробуйте ще раз.');
}

const catalogStates = {
  discovery: 'Шукаємо картки магазинів', collecting: 'Збираємо картки', verifying: 'Переперевіряємо збір',
  ready: 'Збір завершено', short: 'Доступних карток менше за ціль', error: 'Збір перервано',
  interrupted: 'Збір перервано', review: 'Потрібна перевірка',
};

function renderCatalogRun(run) {
  const form = $('catalog-form');
  const busy = run.state === 'running';
  form.querySelector('button').disabled = busy;
  form.elements.count.disabled = busy;
  if (!run.state) return $('catalog-progress').replaceChildren();
  if (busy) form.elements.count.value = run.target;
  const progress = element('progress');
  progress.max = run.target;
  progress.value = run.products;
  progress.setAttribute('aria-label', 'Нові товари');
  const overview = element('div', 'catalog-report',
    element('strong', '', catalogStates[busy ? run.step : run.state]),
    element('p', '', `Нові товари: ${format.format(run.products)} з ${format.format(run.target)} · Пропозиції: ${format.format(run.offers)}`),
    progress, element('p', 'item-meta', `Переглянуто карток: ${run.checked} · Повторно перевірено: ${run.verified} · Втрачено пропозицій: ${run.missing}`),
    run.verifyFailed ? element('p', 'form-error', `Не підтвердилися при повторній перевірці: ${run.verifyFailed}`) : null,
    run.error ? element('p', 'form-error', run.error) : null);
  for (const source of run.sources) {
    overview.append(element('div', 'catalog-source', element('strong', '', source.name),
      element('span', '', `${source.saved} збережено · ${source.checked} переглянуто · ${source.rejected} без придатних даних`),
      source.warnings.length ? element('span', '', source.warnings.join(' ')) : null));
  }
  $('catalog-progress').replaceChildren(overview);
}

async function monitorCatalog(wasRunning = false) {
  clearTimeout(catalogTimer);
  try {
    const run = await api('/api/catalog-run');
    renderCatalogRun(run);
    if (run.state === 'running') catalogTimer = setTimeout(() => monitorCatalog(true), 1600);
    else if (wasRunning) await reload();
  } catch (error) {
    formError('catalog-error', error);
  }
}

async function probeCli() {
  const target = $('cli-probes');
  target.textContent = 'Перевіряємо вхід…';
  $('check-cli').disabled = true;
  try {
    const result = await api('/api/cli');
    target.replaceChildren(...Object.entries(result).map(([provider, status]) =>
      element('p', '', providerNames[provider], element('span', 'badge ' + (status.loggedIn ? 'ready' : ''),
        status.loggedIn ? 'Вхід активний' : status.installed ? 'Потрібен вхід за підпискою' : 'CLI не встановлено'))));
  } catch (error) { target.textContent = error.message; }
  finally { $('check-cli').disabled = false; }
}

function openCli() {
  formError('cli-error');
  $('cli-form').elements.provider.value = state.provider;
  $('cli-dialog').showModal();
  if (!$('check-cli').disabled) void probeCli();
}

for (const [field, title] of Object.entries(selectorLabels)) {
  const fieldInput = element('input');
  fieldInput.name = `selector-${field}`;
  fieldInput.maxLength = 160;
  fieldInput.placeholder = field === 'price' ? '.product-price' : '';
  $('selectors').append(element('label', '', title, fieldInput));
}
$('source-form').elements.defaultUnit.append(...units.map((unit) => option(unit, unit)));
document.querySelectorAll('[data-close]').forEach((control) => control.addEventListener('click', () => control.closest('dialog').close()));
$('catalog-tab').addEventListener('click', () => navigate('catalog'));
$('sources-tab').addEventListener('click', () => navigate('sources'));
$('product-new').addEventListener('click', () => openProduct());
$('source-new').addEventListener('click', () => openSource());
$('catalog-open').addEventListener('click', () => {
  formError('catalog-error');
  $('catalog-dialog').showModal();
  void monitorCatalog();
});
$('sources-refresh').addEventListener('click', refreshAllSources);
$('cli-open').addEventListener('click', openCli);
$('check-cli').addEventListener('click', probeCli);
$('web-search').addEventListener('click', () => openStoreSearch($('search').value));
$('search').addEventListener('keydown', (event) => {
  if (!demo && event.key === 'Enter') {
    event.preventDefault();
    openStoreSearch($('search').value);
  }
});
for (const id of ['search', 'source-filter', 'stock-filter']) $(id).addEventListener('input', () => {
  catalogPage = 0;
  cancelAnimationFrame(catalogFrame);
  catalogFrame = requestAnimationFrame(() => {
    $('products').scrollTop = 0;
    renderProducts();
  });
});
$('catalog-back').addEventListener('click', returnToCatalog);
narrowCatalog.addEventListener('change', () => {
  const index = filteredGroups().findIndex(({ id }) => id === state.selected);
  catalogPage = Math.floor(Math.max(index, 0) / pageSize());
  renderProducts();
});
$('source-form').elements.kind.addEventListener('change', toggleSourceFields);

$('store-form').elements.query.addEventListener('input', () => { storeProduct = ''; });
$('store-dialog').addEventListener('close', () => {
  storeSearchController?.abort();
  storePreview = null;
});
$('description-dialog').addEventListener('close', queueStoreResults);
$('store-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const query = event.currentTarget.elements.query.value.trim();
  storeSearchController?.abort();
  const controller = new AbortController();
  storeSearchController = controller;
  storePreview = null;
  storeLimit = 24;
  $('store-results').scrollTop = 0;
  $('store-results').replaceChildren(element('p', 'store-search-message', 'Перевіряємо підключені магазини…'));
  try {
    if (await readStoreSearch(query, storeProduct, controller)) await reload();
  } catch (error) {
    if (!controller.signal.aborted) {
      if (storePreview?.sources.size) {
        storePreview.error = error.message;
        storePreview.checking = false;
        queueStoreResults();
      }
      else $('store-results').replaceChildren(element('p', 'store-search-message form-error', error.message));
    }
  }
});

$('catalog-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const submit = event.submitter;
  formError('catalog-error');
  submit.disabled = true;
  try {
    renderCatalogRun(await api('/api/catalog-run', { count: Number(event.currentTarget.elements.count.value) }));
    void monitorCatalog(true);
  } catch (error) {
    formError('catalog-error', error);
    submit.disabled = false;
  }
});

$('product-dialog').addEventListener('cancel', (event) => {
  if ($('product-submit').disabled) event.preventDefault();
});
$('product-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const submit = $('product-submit');
  const dialog = $('product-dialog');
  const controls = [...dialog.querySelectorAll('button')];
  for (const control of controls) control.disabled = true;
  submit.textContent = 'Збираємо…';
  formError('product-error');
  try {
    const { productId } = await api('/api/products', { url: event.currentTarget.elements.url.value });
    await reload();
    $('search').value = '';
    $('source-filter').value = '';
    $('stock-filter').checked = false;
    state.category = '';
    const index = state.groups.findIndex(({ id }) => id === productId);
    if (index >= 0) {
      const group = state.groups[index];
      state.selected = group.id;
      state.quantity = group.product.pack ? String(group.product.pack) : '';
    }
    catalogPage = Math.max(0, Math.floor(index / pageSize()));
    navigate('catalog');
    renderCategories();
    renderProducts();
    dialog.close();
    if (index >= 0 && narrowCatalog.matches) openProductView();
    else $('products').querySelector('.product-select[aria-pressed="true"]')?.scrollIntoView({ block: 'nearest' });
    notice('Пропозицію збережено.');
  } catch (error) {
    formError('product-error', error);
  } finally {
    for (const control of controls) control.disabled = false;
    submit.textContent = 'Зібрати товар';
  }
});

$('source-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  formError('source-error');
  const submit = $('source-submit');
  submit.disabled = true;
  const fields = event.currentTarget.elements;
  try {
    const kind = fields.kind.value;
    const data = { name: fields.name.value, kind, url: fields.url.value, limit: fields.limit.value, productPages: fields.productPages.value,
      recipe: { prefix: fields.prefix.value, selectors: Object.fromEntries(Object.keys(selectorLabels).map((field) => [field, fields[`selector-${field}`].value])),
        defaults: { unit: fields.defaultUnit.value, pack: fields.defaultPack.value,
          currency: fields.defaultCurrency.value, titleWeight: fields.titleWeight.checked } } };
    if (kind === 'csv') {
      const file = fields.file.files[0];
      if (!file || !/\.csv$/i.test(file.name)) throw new Error('Виберіть файл CSV.');
      if (file.size > 6_000_000) throw new Error('Файл завеликий. Максимум 6 МБ.');
      data.csv = await file.text();
    }
    const path = '/api/sources' + (sourceEdit ? '/' + sourceEdit.id + (kind === 'csv' ? '/import' : '') : '');
    await api(path, data, sourceEdit && kind === 'web' ? 'PUT' : 'POST');
    $('source-dialog').close();
    navigate('sources');
    await reload();
  } catch (error) { formError('source-error', error); }
  finally { submit.disabled = false; }
});

$('cli-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const submit = event.submitter;
  formError('cli-error');
  submit.disabled = true;
  try {
    await api('/api/cli', { provider: event.currentTarget.elements.provider.value });
    $('cli-dialog').close();
    await reload();
  } catch (error) { formError('cli-error', error); }
  finally { submit.disabled = false; }
});

$('web-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const submit = event.submitter;
  const target = $('web-results');
  submit.disabled = true;
  target.textContent = 'Шукаємо пропозиції та перевіряємо ціни…';
  try {
    const { results } = await api('/api/search-web', { query: event.currentTarget.elements.query.value, productId: webProduct });
    target.replaceChildren(...(results.length ? results.map(({ address, offers }) => {
      const offer = offers[0];
      const label = new URL(address).hostname;
      const add = button('Додати товар', 'button secondary', () => {
        $('web-dialog').close();
        openProduct(address);
      });
      return element('article', 'web-result', element('div', '', link(offer?.name || label, address),
        element('p', 'item-meta', offer ? `${label} · ${price(offer.price, offer.currency)}` : 'Ціну не вдалося перевірити.')), add);
    }) : [element('p', '', 'Пропозицій за цим запитом не знайдено.')]));
  } catch (error) { target.textContent = error.message; }
  finally { submit.disabled = false; }
});

if (demo) {
  $('download').href = './';
  $('download').addEventListener('click', (event) => demo.downloadCsv(event, filteredGroups(), state.sources));
} else void monitorAvailability();
reload().catch((error) => notice(error.message, true));
