import { recordUsage } from './llm.js';
import { getSettings } from './settings.js';
import { setMeta } from './db.js';

export class EmbeddingError extends Error {
  status: number;
  detail: string;
  constructor(message: string, status = 0, detail = '') {
    super(message);
    this.name = 'EmbeddingError';
    this.status = status;
    this.detail = detail;
  }
}

function semanticKey(config: { baseUrl: string; apiKey: string }): string {
  if (config.apiKey) return config.apiKey;
  const settings = getSettings();
  try {
    if (new URL(config.baseUrl).origin === new URL(settings.provider.baseUrl).origin) {
      return settings.provider.apiKey;
    }
  } catch {
    // Invalid URLs are handled when the request is built.
  }
  return '';
}

export function embeddingConfigured(): boolean {
  const settings = getSettings();
  const config = settings.memory.embedding;
  return Boolean(config.enabled && config.baseUrl && config.model && semanticKey(config));
}

export function embeddingModel(): string {
  return getSettings().memory.embedding.model;
}

function endpoint(baseUrl: string): string {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new EmbeddingError('Embedding 地址不是有效的 URL');
  }
  const path = url.pathname.replace(/\/+$/, '');
  if (path.endsWith('/embeddings')) return url.toString();
  if (path.endsWith('/v1')) url.pathname = `${path}/embeddings`;
  else url.pathname = `${path}/v1/embeddings`.replace(/\/+/g, '/');
  return url.toString();
}

export async function embedTexts(
  texts: string[],
  options: { timeoutMs?: number } = {}
): Promise<Float32Array[]> {
  const settings = getSettings();
  const config = settings.memory.embedding;
  const apiKey = semanticKey(config);
  if (!config.enabled || !apiKey) {
    throw new EmbeddingError('Embedding 未启用或缺少 API Key');
  }
  const clean = texts.map((text) => text.trim()).filter(Boolean);
  if (!clean.length) return [];
  let response: Response;
  try {
    response = await fetch(endpoint(config.baseUrl), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: config.model,
        input: clean,
        encoding_format: 'float'
      }),
      signal: AbortSignal.timeout(options.timeoutMs ?? 30_000)
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setMeta('embedding_last_error', message);
    throw new EmbeddingError('Embedding 请求失败', 0, message);
  }

  if (!response.ok) {
    const detail = (await response.text().catch(() => '')).slice(0, 500);
    const message = `Embedding 请求失败（${response.status}）`;
    setMeta('embedding_last_error', `${message} ${detail}`);
    recordUsage(
      'embedding',
      config.model,
      { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      false,
      message
    );
    throw new EmbeddingError(message, response.status, detail);
  }

  const data = (await response.json()) as any;
  const items = Array.isArray(data?.data) ? data.data : [];
  if (!items.length) {
    setMeta('embedding_last_error', 'Embedding 返回为空');
    throw new EmbeddingError('Embedding 返回为空');
  }
  const ordered = [...items].sort((a, b) => Number(a.index ?? 0) - Number(b.index ?? 0));
  const vectors: Float32Array[] = [];
  for (const item of ordered) {
    const raw = item?.embedding;
    if (!Array.isArray(raw) || raw.length < 8) {
      throw new EmbeddingError('Embedding 返回的向量格式不正确');
    }
    const vector = Float32Array.from(raw.map(Number));
    if (vector.some((value) => !Number.isFinite(value))) {
      throw new EmbeddingError('Embedding 返回了非法数值');
    }
    vectors.push(vector);
  }
  if (vectors.length !== clean.length) {
    throw new EmbeddingError('Embedding 返回数量与请求不一致');
  }
  const dimensions = vectors[0].length;
  if (vectors.some((vector) => vector.length !== dimensions)) {
    throw new EmbeddingError('Embedding 返回的向量维度不一致');
  }
  setMeta('embedding_last_error', '');
  setMeta('embedding_model', config.model);
  const tokens = Number(data?.usage?.prompt_tokens ?? data?.usage?.total_tokens ?? 0);
  recordUsage(
    'embedding',
    config.model,
    {
      promptTokens: tokens || Math.ceil(clean.join('').length / 3),
      completionTokens: 0,
      totalTokens: tokens || Math.ceil(clean.join('').length / 3)
    },
    true,
    null
  );
  return vectors;
}
