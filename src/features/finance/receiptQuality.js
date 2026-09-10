export function analyzeReceiptPixels({ width, height, pixels, sampleWidth = width, sampleHeight = height }) {
  const issues = [];
  if (Math.min(width, height) < 800) issues.push({ code: 'low_resolution', message: '사진 해상도가 낮아요. 영수증에 더 가까이 촬영해 주세요.' });
  if (!pixels?.length) return issues;
  let brightness = 0; let gradients = 0; let comparisons = 0;
  const luminance = [];
  for (let index = 0; index < pixels.length; index += 4) {
    const value = pixels[index] * 0.299 + pixels[index + 1] * 0.587 + pixels[index + 2] * 0.114;
    luminance.push(value); brightness += value;
  }
  brightness /= luminance.length;
  for (let y = 1; y < sampleHeight; y += 1) for (let x = 1; x < sampleWidth; x += 1) {
    const index = y * sampleWidth + x; gradients += Math.abs(luminance[index] - luminance[index - 1]) + Math.abs(luminance[index] - luminance[index - sampleWidth]); comparisons += 2;
  }
  const sharpness = comparisons ? gradients / comparisons : 0;
  if (brightness < 45) issues.push({ code: 'too_dark', message: '사진이 너무 어두워요. 밝은 곳에서 다시 촬영해 주세요.' });
  if (brightness > 242) issues.push({ code: 'too_bright', message: '빛 반사가 강해요. 플래시를 끄거나 각도를 바꿔 주세요.' });
  if (sharpness < 3.2) issues.push({ code: 'blurred', message: '글자가 흐릴 수 있어요. 초점을 맞추고 흔들리지 않게 촬영해 주세요.' });
  return issues;
}

export async function inspectReceiptImage(file) {
  if (!file?.type?.startsWith('image/') || typeof createImageBitmap !== 'function' || typeof document === 'undefined') return [];
  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 320 / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale)); const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return [];
    context.drawImage(bitmap, 0, 0, width, height);
    const pixels = context.getImageData(0, 0, width, height).data;
    return analyzeReceiptPixels({ width: bitmap.width, height: bitmap.height, pixels, sampleWidth: width, sampleHeight: height });
  } catch { return []; }
  finally { bitmap?.close?.(); }
}
