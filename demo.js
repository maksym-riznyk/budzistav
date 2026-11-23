import { offersCsv } from './export.js';
import { quote, stockLabels } from './model.js';

export async function loadCatalog() {
  const response = await fetch('./catalog.json');
  if (!response.ok) throw new Error('Не вдалося завантажити каталог. Спробуйте оновити сторінку.');
  return response.json();
}

export function downloadCsv(event, groups, sources, quantity) {
  event.preventDefault();
  const csv = offersCsv(groups, sources, (offer) => quote(offer, quantity), stockLabels);
  const href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const file = document.createElement('a');
  file.href = href;
  file.download = 'porivniannia.csv';
  file.click();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}
