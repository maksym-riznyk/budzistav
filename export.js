const labels = { UAH: 'грн', EUR: 'EUR', USD: 'USD', PLN: 'PLN' };

export function csvText(rows) {
  return '\uFEFF' + rows.map((row) => row.map((value) => {
    let text = String(value ?? '');
    if (typeof value === 'string' && /^[\s]*[=+\-@\t\r\n]/.test(text)) text = "'" + text;
    return '"' + text.replaceAll('"', '""') + '"';
  }).join(';')).join('\r\n') + '\r\n';
}

export function offersCsv(groups, sources, quoteFor, stockLabels) {
  const rows = [['Товар', 'Постачальник', 'Артикул', 'Одиниця', 'В упаковці', 'Ціна за упаковку',
    'Валюта', 'Ціна за одиницю', 'Упаковок', 'Обсяг', 'Разом', 'Наявність', 'Оновлено', 'Посилання']];
  for (const group of groups) {
    for (const offer of group.offers) {
      const quote = quoteFor(offer);
      const source = sources.find(({ id }) => id === offer.sourceId);
      const amount = offer.priceSaved ? null : offer.price;
      rows.push([group.product.name, source?.name, offer.sku, offer.unit, offer.pack, amount,
        labels[offer.currency], amount > 0 && offer.pack ? Math.round(amount / offer.pack * 100) / 100 : '',
        quote?.packs, quote?.quantity, quote?.total, stockLabels[offer.stock], offer.observedAt, offer.url]);
    }
  }
  return csvText(rows);
}
