export const categories = ['Утеплення', 'Плитні матеріали', 'Будівельні суміші', 'Стінові блоки', 'Гіпсокартон', 'Профілі та кріплення', 'Інше'];
export const stockLabels = { in: 'В наявності', out: 'Немає', order: 'Під замовлення', unknown: 'Уточнити' };
export const units = ['шт', 'м²', 'м³', 'м', 'кг', 'л'];

export function clean(value, size = 240) {
  return typeof value === 'string' || typeof value === 'number'
    ? String(value).replace(/[\x00-\x1f\x7f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, size)
    : '';
}

export function normalize(value) {
  return clean(value, 1000).toLocaleLowerCase('uk').normalize('NFKC')
    .replace(/['’ʼ]/g, '').replace(/(?<=\d)\s*[хx×*]\s*(?=\d)/g, '×')
    .replace(/[^\p{L}\p{N}×.,]+/gu, ' ').trim();
}

export function decimal(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : NaN;
  const raw = clean(value).replace(/\s/g, '').replace(',', '.');
  return /^\d+(\.\d+)?$/.test(raw) ? Number(raw) : NaN;
}

export function webUrl(value, base) {
  if (typeof value !== 'string' || !value.trim()) return '';
  try {
    const url = new URL(value, base);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.href.length > 1600) return '';
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|fbclid$|gclid$)/i.test(key)) url.searchParams.delete(key);
    }
    return url.href;
  } catch {
    return '';
  }
}

export function categoryFor(value) {
  const name = normalize(value);
  const patterns = [/вата|утепл|мінват|ізоляц|ізовер|пінополістир|rockwool|isover|eps|xps/,
    /\bosb\b|осб|фанер|дсп|плитн/, /суміш|клей|штукатур|шпаклів|цемент|стяжк/,
    /газоблок|бетон|цегл|стінов\p{L}* блок/u, /гіпсокартон|гкл|гіпсоплит/,
    /профіль|профіл|дюбел|саморіз|кріпл/];
  return categories[patterns.findIndex((pattern) => pattern.test(name))] ?? 'Інше';
}

function measure(rawUnit, rawPack) {
  const value = clean(rawUnit).toLowerCase().replace(/\s|\./g, '');
  const names = {
    штука: 'шт', штук: 'шт', piece: 'шт', pcs: 'шт', pc: 'шт', h87: 'шт',
    m2: 'м²', м2: 'м²', 'm²': 'м²', мкв: 'м²', квм: 'м²', mtk: 'м²',
    m3: 'м³', м3: 'м³', 'm³': 'м³', mtq: 'м³',
    kg: 'кг', kgm: 'кг', m: 'м', mtr: 'м', l: 'л', ltr: 'л',
  };
  const unit = names[value] ?? value;
  const pack = decimal(rawPack ?? 1);
  if (!Number.isFinite(pack) || pack <= 0 || pack > 100_000) return {};
  if (['г', 'g', 'grm'].includes(unit)) return { unit: 'кг', pack: pack / 1000 };
  if (['мм', 'mm', 'mmt'].includes(unit)) return { unit: 'м', pack: pack / 1000 };
  if (['см', 'cm', 'cmt'].includes(unit)) return { unit: 'м', pack: pack / 100 };
  if (['мл', 'ml', 'mlt'].includes(unit)) return { unit: 'л', pack: pack / 1000 };
  return units.includes(unit) ? { unit, pack } : {};
}

function stockFor(value) {
  if (Object.hasOwn(stockLabels, value)) return value;
  if (value === true) return 'in';
  if (value === false) return 'out';
  const text = normalize(value);
  if (/out ?of ?stock|sold ?out|discontinued|немає|відсутн|нет в наличии/.test(text)) return 'out';
  if (/pre ?order|presale|back ?order|замовлен|под заказ/.test(text)) return 'order';
  if (/in ?stock|в наявності|є в наявності|в наличии/.test(text)) return 'in';
  if (/^\d+$/.test(text)) return Number(text) > 0 ? 'in' : 'out';
  return 'unknown';
}

function dimensionKey(value) {
  const normalized = normalize(value).replace(/(?:\s+|(?<=\d))(mm|мм)$/i, '');
  if (!/^\d+(?:[.,]\d+)?(?:×\d+(?:[.,]\d+)?){1,2}$/.test(normalized)) return normalized;
  return normalized.split('×').map(decimal).sort((a, b) => a - b).join('×');
}

export function weightInTitle(title) {
  const weights = new Set([...title.matchAll(/(?:^|[^\p{L}\p{N}])(\d+(?:[.,]\d+)?)\s*(кг|kg|г|g)(?![\p{L}\p{N}])/giu)]
    .map(([, value, unit]) => decimal(value) / (/^(?:г|g)$/i.test(unit) ? 1000 : 1)));
  return weights.size === 1 ? [...weights][0] : null;
}

export function volumeInTitle(title) {
  const volumes = new Set([...title.matchAll(/(?:^|[^\p{L}\p{N}])(\d+(?:[.,]\d+)?)\s*(мл|ml|л|l)(?![\p{L}\p{N}])/giu)]
    .map(([, value, unit]) => decimal(value) / (/^(?:мл|ml)$/i.test(unit) ? 1000 : 1)));
  return volumes.size === 1 ? [...volumes][0] : null;
}

const codeLetters = { с: 'c', м: 'm', т: 't', п: 'p', р: 'p', н: 'n' };

export function normalizeModelCodes(value) {
  return normalize(value).replace(/(?<![\p{L}\p{N}])([cс][mмtтnнrр]|[tтpпр])\s*(\d{1,3})(?![\p{L}\p{N}])/gu,
    (_, prefix, number) => (prefix.length === 2 && prefix[1] === 'р' ? 'cr'
      : [...prefix].map((letter) => codeLetters[letter] || letter).join('')) + ' ' + number);
}

const codedBrands = [
  { brand: 'Ceresit', brandName: /ceresit|церез[іи]т/, codes: /\b(cm (?:11|12|14|16|17|22|49|115|117)|cr 65|ct 29|cn 68)\b/g },
  { brand: 'Siltek', brandName: /siltek|с[іи]лтек/, codes: /\b(t (?:80|801|81|82|803|83|84|88|90|91))\b/g },
  { brand: 'Polimin', brandName: /polimin|пол[іи]м[іи]н/, codes: /\b(p (?:9|10|11|12|14|22|24|25))\b/g },
];

function codedMix(name, brand, description = '') {
  const label = normalizeModelCodes(name);
  const family = codedBrands.find(({ brandName }) => brandName.test(label + ' ' + normalize(brand)));
  if (!family) return null;
  const models = new Set([...label.matchAll(family.codes)].map(([, code]) => code));
  if (models.size !== 1) return null;
  const [code] = models;
  const variant = [];
  for (const [pattern, variantName] of [
    [/\bplus\b|плюс/, 'Plus'], [/\bpro\b|(?:^| )про(?:[., ]|$)/, 'Pro'],
    [/\bexpress\b|експрес|экспресс/, 'Express'], [/\baero\b|аеро/, 'Aero'],
    [/\bwinter\b|зимов|зимн/, 'Winter'], [/\b(?:white|weiss)\b|(?:^| )б[іе]л(?:ий|ый|а|ая)(?:[., ]|$)/, 'White'],
  ]) {
    if (pattern.test(label)) variant.push(variantName);
  }
  if (family.brand === 'Siltek' && code === 't 82' && !variant.includes('White') && !/сірий|серый|gr[ae]y/.test(label)) {
    variant.push('White');
  }
  if (family.brand === 'Polimin' && ['p 24', 'p 25'].includes(code)) {
    const color = description.match(/(?:колір|цвет)(?: суміші)?\s*:?\s*(білий|белый|сірий|серый|white|grey|gray)/iu)?.[1] || '';
    if (/білий|белый|white/i.test(color) && !variant.includes('White')) variant.push('White');
    if (/сірий|серый|gr[ae]y/i.test(label + ' ' + color)) variant.push('Grey');
  }
  const displayCode = family.brand === 'Ceresit' ? code.toUpperCase() : code.toUpperCase().replace(' ', '-');
  const search = family.brand + ' ' + displayCode;
  const displayVariant = variant.length ? variant.join(' ')
    : family.brand === 'Ceresit' && code === 'cm 117' ? 'Flex' : '';
  return { search, title: [search, displayVariant].filter(Boolean).join(' '),
    code: [code.replace(' ', '-'), ...variant.map((value) => value.toLowerCase())].join('-'), brand: family.brand };
}

export function storeSearchName(offer) {
  if (/model\/knauf\/polymer-finish\//.test(offer.identity)) return 'Knauf Polymer Finish';
  return codedMix(offer.name, offer.brand)?.search || offer.name;
}

function packagedModel(name, brand, unit, pack, origin = '', description = '') {
  const label = normalize(name + ' ' + brand);
  const weight = weightInTitle(name);
  if (unit === 'кг' && pack === 20 && (!weight || weight === pack) && /(?:knauf|кнауф)/.test(label)
    && /(?:pol[yi]mer finish|пол[іи]мер ф[іи]н[іи]ш)(?:[\s.,]|$)/.test(label)) {
    const moldova = /молдова|moldova/.test(label + ' ' + normalize(origin));
    return { key: 'model/knauf/polymer-finish/20kg' + (moldova ? '/md' : ''),
      name: 'Шпаклівка Knauf Polymer Finish, 20 кг' + (moldova ? ' (Молдова)' : ''), brand: 'Knauf' };
  }
  if (weight === 30 && (unit !== 'кг' || pack === weight)
    && /knauf|кнауф/.test(label) && /rotband|ротбанд/.test(label) && /штукатур|plaster/.test(label)
    && !/finish|фініш|финиш|паста|pasta/.test(label)) {
    const pro = /(?:rotband|ротбанд)\s+(?:pro|про)(?=[\s.,]|$)/.test(label);
    return { key: `model/knauf/rotband${pro ? '-pro' : ''}/30kg`,
      name: `Штукатурка Knauf Rotband${pro ? ' Pro' : ''}, 30 кг`, brand: 'Knauf' };
  }
  const mix = unit === 'кг' && pack > 0 && (!weight || weight === pack) && codedMix(name, brand, description);
  if (!mix) return null;
  const prefix = mix.code === 'cm-11-plus' ? 'Клей для плитки ' : '';
  return { key: ['model', mix.brand.toLowerCase(), mix.code, pack + 'kg'].join('/'),
    name: prefix + mix.title + ', ' + pack + ' кг', brand: mix.brand };
}

function manufacturerCode(value) {
  const code = clean(value, 80);
  return /^(pce|pcs|piece|h87|kgm|mtr|mtk|mtq|ltr|шт|кг)$/i.test(code) ? '' : code;
}

export function makeOffer(raw, { availability = false } = {}) {
  const name = clean(raw.name);
  const currency = clean(raw.currency).toUpperCase();
  const amount = decimal(raw.price);
  const stock = stockFor(raw.stock);
  const priced = Number.isFinite(amount) && amount > 0 && amount <= 100_000_000;
  if (!name || (!priced && (!availability || stock === 'unknown'))) return null;
  if (!['UAH', 'EUR', 'USD', 'PLN', ''].includes(currency)) return null;
  const sku = clean(raw.sku, 80);
  const mpn = manufacturerCode(raw.mpn);
  const brand = clean(raw.brand, 80);
  const suppliedGtin = clean(raw.gtin).replace(/\s/g, '');
  const gtin = /^(\d{8}|\d{12,14})$/.test(suppliedGtin) && [...suppliedGtin].reverse()
    .reduce((sum, digit, index) => sum + Number(digit) * (index % 2 ? 3 : 1), 0) % 10 === 0
    ? suppliedGtin.padStart(14, '0') : '';
  const url = webUrl(raw.url);
  const image = webUrl(raw.image);
  const images = [...new Set([image, ...(Array.isArray(raw.images) ? raw.images : [])].map((value) => webUrl(value)).filter(Boolean))].slice(0, 4);
  const description = typeof raw.description === 'string' ? raw.description.slice(0, 6000)
    .split(/\r?\n/).map((line) => clean(line, 1600)).filter(Boolean).join('\n').slice(0, 1600) : '';
  const origin = clean(raw.origin, 50);
  const category = categories.includes(raw.category) ? raw.category : categoryFor(`${raw.category ?? ''} ${name}`);
  const dimensions = clean(raw.dimensions, 80) || normalize(name).match(/\d+(?:[.,]\d+)?(?:×\d+(?:[.,]\d+)?){1,2}/)?.[0] || '';
  const { unit = '', pack = null } = measure(raw.unit, raw.pack);
  const model = packagedModel(name, brand, unit, pack, origin, description);
  const baseIdentity = model?.key || (gtin ? `gtin/${gtin}`
    : mpn && brand ? `mpn/${normalize(brand)}/${normalize(mpn)}/${dimensionKey(dimensions)}`
    : `name/${normalize(brand)}/${normalize(name)}/${dimensionKey(dimensions)}`);
  return {
    key: JSON.stringify([sku || url || name, unit, pack, dimensions]),
    identity: JSON.stringify([baseIdentity, unit, currency]), name, brand, sku, mpn, gtin, category,
    dimensions, price: priced ? Math.round(amount * 100) / 100 : null, currency, pack, unit,
    stock, url, image: images[0] || '', images, description, origin,
    tile: Number.isInteger(raw.tile) && raw.tile >= 0 && raw.tile < 6 ? raw.tile : null,
  };
}

export function repairOfferIdentity(offer) {
  const mpn = manufacturerCode(offer.mpn);
  if (mpn === offer.mpn && !packagedModel(offer.name, offer.brand, offer.unit, offer.pack, offer.origin, offer.description)) return offer;
  const corrected = makeOffer({ ...offer, mpn });
  return corrected ? { ...offer, mpn, identity: corrected.identity } : offer;
}

export function canMerge(a, b) {
  if (a.unit !== b.unit || a.currency !== b.currency) return false;
  if (a.gtin && b.gtin && a.gtin !== b.gtin && a.pack === b.pack) return false;
  const aModel = packagedModel(a.name, a.brand, a.unit, a.pack, a.origin, a.description);
  const bModel = packagedModel(b.name, b.brand, b.unit, b.pack, b.origin, b.description);
  if (aModel || bModel) return aModel?.key === bModel?.key;
  if (a.brand && b.brand && normalize(a.brand) !== normalize(b.brand)) return false;
  if (a.mpn && b.mpn && normalize(a.mpn) !== normalize(b.mpn)) return false;
  return !a.dimensions || !b.dimensions || dimensionKey(a.dimensions) === dimensionKey(b.dimensions);
}

export function refreshedOffer(previous, candidates) {
  const compatible = candidates.filter((offer) => offer.currency === previous.currency
    && (!previous.gtin || !offer.gtin || previous.gtin === offer.gtin));
  const exact = compatible.find((offer) => offer.key === previous.key && offer.identity === previous.identity);
  if (exact) return exact;
  const matches = compatible.filter((offer) => {
    const sameMeasure = offer.unit === previous.unit && offer.pack === previous.pack;
    if (sameMeasure && offer.identity === previous.identity) return true;
    return offer.url === previous.url && normalize(offer.name) === normalize(previous.name)
      && (sameMeasure || !previous.unit
        || previous.unit === 'шт' && previous.pack === 1 && (
          offer.unit === 'кг' && offer.pack === weightInTitle(offer.name)
          || offer.unit === 'л' && offer.pack === volumeInTitle(offer.name)
        ));
  });
  return matches.length === 1 ? matches[0] : null;
}

export function groupOffers(offers, decisions = {}) {
  const groups = new Map();
  for (const offer of offers) {
    const id = decisions[offer.id] ?? offer.identity;
    if (!groups.has(id)) groups.set(id, { id, offers: [], product: offer });
    const group = groups.get(id);
    group.offers.push(offer);
    const productQuality = (item) => Number(item.tile !== null) * 3 + Number(Boolean(item.image)) + Number(Boolean(item.brand));
    if (productQuality(offer) > productQuality(group.product)) group.product = offer;
  }
  return [...groups.values()].map((group) => {
    const { product } = group;
    const model = packagedModel(product.name, product.brand, product.unit, product.pack, product.origin, product.description);
    if (!model) return group;
    return { ...group, product: { ...product, name: model.name, brand: model.brand, mpn: '' } };
  });
}

export function quote(offer, quantity) {
  if (!(offer.price > 0) || offer.priceSaved || !offer.pack || !Number.isFinite(quantity) || quantity <= 0 || quantity > 100_000) return null;
  const packs = Math.ceil(Number((quantity / offer.pack).toPrecision(12)));
  return { packs, quantity: Number((packs * offer.pack).toPrecision(10)), total: Math.round(packs * offer.price * 100) / 100 };
}

const searchText = new WeakMap();
const searchTerms = (value) => normalizeModelCodes(value)
  .replace(/(?<![\p{L}])кнауф(?![\p{L}])/gu, 'knauf')
  .replace(/(?<![\p{L}])(?:polimer|пол[іи]мер)(?![\p{L}])/gu, 'polymer')
  .replace(/(?<![\p{L}])ф[іи]н[іи]ш(?![\p{L}])/gu, 'finish');

export function indexSearch(offer) {
  if (!searchText.has(offer)) {
    const label = [offer.name, offer.brand, offer.sku, offer.mpn, offer.gtin, offer.category, offer.dimensions].join(' ');
    searchText.set(offer, searchTerms(label) + ' ' + searchTerms(offer.description));
  }
  return searchText.get(offer);
}

export function catalogMatcher(query) {
  const words = searchTerms(query).split(' ').filter(Boolean);
  return words.length ? (offer) => {
    const text = indexSearch(offer);
    return words.every((word) => text.includes(word));
  } : () => true;
}

export function matchSearch(offer, query) {
  return catalogMatcher(query)(offer);
}

export function alternatives(product, groups) {
  const words = new Set(normalize(product.name).split(' ').filter((word) => word.length > 2));
  return groups.filter(({ product: other }) => other.id !== product.id && other.identity !== product.identity
    && other.category === product.category && other.unit === product.unit && other.currency === product.currency)
    .map((group) => {
      const other = group.product;
      const common = normalize(other.name).split(' ').filter((word) => words.has(word)).length;
      const points = common + (other.brand && normalize(other.brand) === normalize(product.brand) ? 2 : 0)
        + (other.dimensions && dimensionKey(other.dimensions) === dimensionKey(product.dimensions) ? 3 : 0);
      return { group, points };
    }).filter(({ points }) => points > 0).sort((a, b) => b.points - a.points).slice(0, 6).map(({ group }) => group);
}
