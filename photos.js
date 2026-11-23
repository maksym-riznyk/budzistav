const cache = new Map();

async function signature(address) {
  const response = await fetch('/api/image?url=' + encodeURIComponent(address));
  if (!response.ok) return null;
  const image = await createImageBitmap(await response.blob());
  const canvas = new OffscreenCanvas(9, 8);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.fillStyle = 'white';
  context.fillRect(0, 0, 9, 8);
  context.drawImage(image, 0, 0, 9, 8);
  image.close();
  const { data } = context.getImageData(0, 0, 9, 8);
  const gray = Array.from({ length: 72 }, (_, i) => .299 * data[i * 4] + .587 * data[i * 4 + 1] + .114 * data[i * 4 + 2]);
  const bits = gray.flatMap((pixel, i) => (i + 1) % 9 ? [pixel < gray[i + 1]] : []);
  const contrast = Math.max(...gray) - Math.min(...gray);
  return contrast >= 30 ? { bits, mean: gray.reduce((sum, pixel) => sum + pixel, 0) / gray.length } : null;
}

function cached(address) {
  if (!cache.has(address)) {
    if (cache.size >= 64) cache.delete(cache.keys().next().value);
    cache.set(address, signature(address).catch(() => null));
  }
  return cache.get(address);
}

export async function comparePhotos(first, second) {
  if (!first || !second) return false;
  if (first === second) return true;
  const [a, b] = await Promise.all([cached(first), cached(second)]);
  if (!a || !b || Math.abs(a.mean - b.mean) > 25) return false;
  return a.bits.filter((bit, i) => bit !== b.bits[i]).length <= 7;
}
