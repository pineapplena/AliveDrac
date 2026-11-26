export interface ParsedCard {
  card: Record<string, any>;
  avatarDataUrl?: string;
}

function decodeBase64Utf8(value: string): string {
  const binary = atob(value.replace(/\s+/g, ''));
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder('utf-8').decode(bytes);
}

function readPngChunks(buffer: ArrayBuffer): { keyword: string; text: string }[] {
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  if (bytes.length < 8 || bytes[0] !== 0x89 || bytes[1] !== 0x50) {
    throw new Error('这不是一张有效的 PNG');
  }
  const decoder = new TextDecoder('latin1');
  const chunks: { keyword: string; text: string }[] = [];
  let offset = 8;
  while (offset + 12 <= bytes.length) {
    const length = view.getUint32(offset);
    const type = decoder.decode(bytes.slice(offset + 4, offset + 8));
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > bytes.length) break;
    if (type === 'tEXt') {
      const data = bytes.slice(dataStart, dataEnd);
      const zero = data.indexOf(0);
      if (zero > 0) {
        const keyword = decoder.decode(data.slice(0, zero));
        const text = decoder.decode(data.slice(zero + 1));
        chunks.push({ keyword, text });
      }
    }
    offset = dataEnd + 4;
    if (type === 'IEND') break;
  }
  return chunks;
}

function arrayBufferToDataUrl(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return `data:image/png;base64,${btoa(binary)}`;
}

export async function parseCardFile(file: File): Promise<ParsedCard> {
  if (file.size > 20 * 1024 * 1024) throw new Error('文件太大了（上限 20MB）');
  const buffer = await file.arrayBuffer();
  const isPng = file.name.toLowerCase().endsWith('.png') || file.type === 'image/png';
  let card: Record<string, any>;
  let avatarDataUrl: string | undefined;

  if (isPng) {
    const chunks = readPngChunks(buffer);
    const chunk =
      chunks.find((item) => item.keyword === 'ccv3') ??
      chunks.find((item) => item.keyword === 'chara');
    if (!chunk) {
      throw new Error('这张 PNG 里没有角色卡数据（缺少 chara 字段）');
    }
    card = JSON.parse(decodeBase64Utf8(chunk.text)) as Record<string, any>;
    avatarDataUrl = arrayBufferToDataUrl(buffer);
  } else {
    const text = new TextDecoder('utf-8').decode(buffer);
    card = JSON.parse(text) as Record<string, any>;
  }

  if (!card || typeof card !== 'object') throw new Error('角色卡内容不是对象');
  if (card.data && typeof card.data === 'object' && !card.name) {
    card = card.data as Record<string, any>;
  }
  return { card, avatarDataUrl };
}

export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error('读取文件失败'));
    reader.readAsDataURL(file);
  });
}
