import { recordUsage } from './llm.js';
import { getSettings } from './settings.js';
import { setMeta } from './db.js';

export class RerankError extends Error {
  status: number;
  detail: string;
  constructor(message: string, status = 0, detail = '') {
    super(message);
    this.name = 'RerankError';
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

export function rerankConfigured(): boolean {
  const settings = getSettings();
  const config = settings.memory.rerank;
  return Boolean(config.enabled && config.baseUrl && config.model && semanticKey(config));
}

export function rerankModel(): string {
  return getSettings().memory.rerank.model;
}

function endpoint(baseUrl: string): string {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new RerankError('Rerank 地址不是有效的 URL');
  }
  const path = url.pathname.replace(/\/+$/, '');
  if (path.endsWith('/rerank')) return url.toString();
  if (path.endsWith('/v1')) url.pathname = `${path}/rerank`;
  else url.pathname = `${path}/v1/rerank`.replace(/\/+/g, '/');
  return url.toString();
}

export async function rerankDocuments(
  query: string,
  documents: string[],
  options: { timeoutMs?: number } = {}
): Promise<number[]> {
  const settings = getSettings();
  const config = settings.memory.rerank;
  const apiKey = semanticKey(config);
  if (!config.enabled || !apiKey || documents.length === 0) return [];
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
        query,
        documents,
        top_n: Math.min(config.topN, documents.length),
        return_documents: false
      }),
      signal: AbortSignal.timeout(options.timeoutMs ?? 30_000)
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setMeta('rerank_last_error', message);
    throw new RerankError('Rerank 请求失败', 0, message);
  }

  if (!response.ok) {
    const detail = (await response.text().catch(() => '')).slice(0, 500);
    const message = `Rerank 请求失败（${response.status}）`;
    setMeta('rerank_last_error', `${message} ${detail}`);
    recordUsage(
      'rerank',
      config.model,
      { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      false,
      message
    );
    throw new RerankError(message, response.status, detail);
  }

  const data = (await response.json()) as any;
  const results = Array.isArray(data?.results) ? data.results : [];
  if (!results.length) {
    setMeta('rerank_last_error', 'Rerank 返回为空');
    throw new RerankError('Rerank 返回为空');
  }
  const scores = new Array(documents.length).fill(0) as number[];
  for (const result of results) {
    const index = Number(result?.index);
    if (!Number.isInteger(index) || index < 0 || index >= scores.length) continue;
    const score = Number(result?.relevance_score ?? result?.score ?? 0);
    scores[index] = Number.isFinite(score) ? score : 0;
  }
  setMeta('rerank_last_error', '');
  setMeta('rerank_model', config.model);
  const tokens = Number(data?.usage?.total_tokens ?? data?.usage?.prompt_tokens ?? 0);
  recordUsage(
    'rerank',
    config.model,
    {
      promptTokens: tokens || Math.ceil((query.length + documents.join('').length) / 3),
      completionTokens: 0,
      totalTokens: tokens || Math.ceil((query.length + documents.join('').length) / 3)
    },
    true,
    null
  );
  return scores;
}
