import type { LearningSourceType } from '../shared/types.js';
import { getSettings } from './settings.js';

export interface RawSearchResult {
  title: string;
  url: string;
  siteName: string;
  snippet: string;
  summary: string;
  content: string;
  authority: number;
  rerank: number;
}

export interface ResearchSource {
  title: string;
  url: string;
  siteName: string;
  type: LearningSourceType;
  snippet: string;
  excerpt: string;
  authority: number;
  fetched: boolean;
}

export interface ResearchResult {
  sources: ResearchSource[];
  context: string;
  error: string | null;
}

const VIDEO_HOSTS = [
  'bilibili.com',
  'b23.tv',
  'youtube.com',
  'youtu.be',
  'vimeo.com',
  'douyin.com',
  'ixigua.com',
  'nicovideo.jp'
];

function providerOrigin(): string | null {
  try {
    const url = new URL(getSettings().provider.baseUrl);
    return url.origin;
  } catch {
    return null;
  }
}

export function researchConfigured(): boolean {
  const settings = getSettings();
  return Boolean(settings.provider.apiKey) && !settings.provider.mock && Boolean(providerOrigin());
}

function toolEndpoint(tool: 'search' | 'fetch'): string {
  const origin = providerOrigin();
  if (!origin) throw new Error('主模型地址不可用');
  return `${origin}/v1/tools/${tool}`;
}

export function isVideoUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return VIDEO_HOSTS.some((item) => host === item || host.endsWith(`.${item}`));
  } catch {
    return false;
  }
}

export function safePublicUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    if (url.username || url.password) return null;
    if (url.toString().length > 8192) return null;
    const host = url.hostname.toLowerCase();
    if (
      host === 'localhost' ||
      host === '0.0.0.0' ||
      host === '::1' ||
      host.endsWith('.local') ||
      /^127\./.test(host) ||
      /^10\./.test(host) ||
      /^192\.168\./.test(host) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(host)
    ) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

async function postTool(
  tool: 'search' | 'fetch',
  body: Record<string, unknown>
): Promise<any> {
  const settings = getSettings();
  if (!settings.provider.apiKey) throw new Error('主模型没有 API Key');
  if (settings.provider.mock) throw new Error('离线演示模式不能联网');
  const response = await fetch(toolEndpoint(tool), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${settings.provider.apiKey}`
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(25_000)
  });
  if (!response.ok) {
    const detail = (await response.text().catch(() => '')).slice(0, 300);
    throw new Error(`联网${tool === 'search' ? '搜索' : '抓取'}失败（${response.status}）${detail}`);
  }
  return response.json();
}

export async function searchWeb(query: string, count = 6): Promise<RawSearchResult[]> {
  const cleaned = query.replace(/\s+/g, ' ').trim().slice(0, 128);
  if (!cleaned) return [];
  const data = await postTool('search', {
    query: cleaned,
    count: Math.min(10, Math.max(1, count)),
    need_content: true
  });
  const results: RawSearchResult[] = [];
  for (const item of Array.isArray(data?.results) ? data.results : []) {
    const url = safePublicUrl(String(item?.url ?? ''));
    if (!url) continue;
    results.push({
      title: String(item?.title ?? url).slice(0, 200),
      url,
      siteName: String(item?.site_name ?? '').slice(0, 80),
      snippet: String(item?.snippet ?? '').slice(0, 400),
      summary: String(item?.summary ?? '').slice(0, 1200),
      content: String(item?.content ?? '').slice(0, 6000),
      authority: Number(item?.authority ?? -1),
      rerank: Number(item?.rerank_score ?? 0)
    });
  }
  return results;
}

export async function fetchPage(url: string): Promise<{ title: string; content: string }> {
  const safe = safePublicUrl(url);
  if (!safe) throw new Error('这个网址不能被安全抓取');
  const data = await postTool('fetch', { url: safe });
  return {
    title: String(data?.title ?? '').slice(0, 200),
    content: String(data?.content ?? '').slice(0, 12_000)
  };
}

export async function researchQuestion(question: string): Promise<ResearchResult> {
  const settings = getSettings();
  if (!settings.learning.researchEnabled) {
    return { sources: [], context: '', error: null };
  }
  if (!researchConfigured()) {
    return { sources: [], context: '', error: '联网资料需要 DeepSeek 主模型的 API Key，离线演示不能联网' };
  }
  try {
    const raw = await searchWeb(question, 8);
    const ranked = raw
      .filter((item) => settings.learning.videoEnabled || !isVideoUrl(item.url))
      .sort((a, b) => b.rerank + b.authority * 0.1 - (a.rerank + a.authority * 0.1))
      .slice(0, 4);
    if (!ranked.length) return { sources: [], context: '', error: '没有搜到合适的资料' };

    const sources: ResearchSource[] = [];
    let fetchBudget = 2;
    for (const item of ranked) {
      let content = item.content;
      let fetched = Boolean(content);
      let title = item.title;
      if ((content.length < 350 || !content) && fetchBudget > 0) {
        try {
          const page = await fetchPage(item.url);
          fetchBudget--;
          if (page.content) {
            content = page.content;
            fetched = true;
            if (page.title) title = page.title;
          }
        } catch {
          // A single inaccessible page should not abort the research.
        }
      }
      const excerpt = (content || item.summary || item.snippet).replace(/\s+/g, ' ').trim().slice(0, 1200);
      sources.push({
        title,
        url: item.url,
        siteName: item.siteName,
        type: isVideoUrl(item.url) ? 'video' : 'web',
        snippet: item.summary || item.snippet,
        excerpt,
        authority: Number.isFinite(item.authority) ? item.authority : -1,
        fetched
      });
    }
    if (!sources.length) return { sources: [], context: '', error: '资料都打不开' };

    const context = sources
      .map(
        (source, index) =>
          `[${index + 1}] ${source.title}（${source.siteName || new URL(source.url).hostname}）\n${source.url}\n${source.excerpt}`
      )
      .join('\n\n');
    return { sources, context, error: null };
  } catch (error) {
    return {
      sources: [],
      context: '',
      error: error instanceof Error ? error.message : '联网搜索失败'
    };
  }
}
