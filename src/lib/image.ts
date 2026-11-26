export interface PreparedImage {
  dataUrl: string;
  width: number;
  height: number;
  name: string;
}

const MAX_BYTES = 8 * 1024 * 1024;
const MAX_SIDE = 1600;

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('这张图片读不出来'));
    };
    image.src = url;
  });
}

export async function prepareImage(file: File): Promise<PreparedImage> {
  if (!file.type.startsWith('image/')) throw new Error('只能发送图片');
  if (file.type === 'image/gif') {
    const dataUrl = await readAsDataUrl(file);
    if (file.size > MAX_BYTES) throw new Error('GIF 不能超过 8MB');
    return { dataUrl, width: 0, height: 0, name: file.name };
  }
  if (file.size > 20 * 1024 * 1024) throw new Error('图片不能超过 20MB');
  const image = await loadImage(file);
  let width = image.naturalWidth;
  let height = image.naturalHeight;
  const scale = Math.min(1, MAX_SIDE / Math.max(width, height));
  width = Math.max(1, Math.round(width * scale));
  height = Math.max(1, Math.round(height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('浏览器不支持图片处理');
  context.drawImage(image, 0, 0, width, height);
  const dataUrl = canvas.toDataURL('image/jpeg', 0.86);
  if (dataUrl.length * 0.75 > MAX_BYTES) {
    throw new Error('图片压缩后还是太大，换一张小一点的吧');
  }
  return { dataUrl, width, height, name: file.name };
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error('读取图片失败'));
    reader.readAsDataURL(file);
  });
}
