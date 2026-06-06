const dataImagePattern = /!\[([^\]]*)\]\((data:image\/[^;]+;base64,[^)]+)\)/g;

const readFileAsDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('Failed to read image file.'));
    reader.readAsDataURL(file);
  });

const loadImage = (dataUrl: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Failed to load image for compression.'));
    image.src = dataUrl;
  });

export const compressImageDataUrl = async (
  dataUrl: string,
  options: { maxDimension?: number; quality?: number } = {}
) => {
  const maxDimension = options.maxDimension ?? 1400;
  const quality = options.quality ?? 0.78;
  const image = await loadImage(dataUrl);
  const scale = Math.min(1, maxDimension / Math.max(image.width, image.height));
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d');
  if (!ctx) return dataUrl;

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(image, 0, 0, width, height);

  const compressed = canvas.toDataURL('image/jpeg', quality);
  return compressed.length < dataUrl.length ? compressed : dataUrl;
};

export const compressImageFile = async (
  file: File,
  options?: { maxDimension?: number; quality?: number }
) => {
  const dataUrl = await readFileAsDataUrl(file);
  return compressImageDataUrl(dataUrl, options);
};

export const compressInlineImagesInMarkdown = async (content: string) => {
  const matches = [...content.matchAll(dataImagePattern)];
  if (matches.length === 0) return content;

  let nextContent = content;
  for (const match of matches) {
    const [fullMatch, alt, dataUrl] = match;
    const compressed = await compressImageDataUrl(dataUrl);
    nextContent = nextContent.replace(fullMatch, `![${alt}](${compressed})`);
  }

  return nextContent;
};
