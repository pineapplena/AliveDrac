import { isVideoUrl, searchWeb, type ResearchSource } from './research.js';

const BV_RE = /\/video\/(BV[0-9A-Za-z]+)/i;
const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36',
  Referer: 'https://www.bilibili.com/',
  Accept: 'application/json,text/plain,*/*'
};

interface VideoInfo {
  bvid: string;
  url: string;
  title: string;
  author: string;
  description: string;
  duration: number;
  cid: number;
  transcript: string;
  hasSubtitle: boolean;
}

async function getJson(url: string, timeout = 15_000): Promise<any> {
  const response = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(timeout) });
  if (!response.ok) throw new Error(`B站接口返回 ${response.status}`);
  return response.json();
}

function bvidOf(url: string): string | null {
  return BV_RE.exec(url)?.[1] ?? null;
}

async function subtitleText(bvid: string, cid: number): Promise<string> {
  const data = await getJson(
    `https://api.bilibili.com/x/player/v2?bvid=${encodeURIComponent(bvid)}&cid=${cid}`
  );
  const subtitles = data?.data?.subtitle?.subtitles;
  if (!Array.isArray(subtitles) || subtitles.length === 0) return '';
  const preferred =
    subtitles.find((item: any) => /zh|ai-zh/i.test(String(item?.lan ?? ''))) ?? subtitles[0];
  let url = String(preferred?.subtitle_url ?? '');
  if (!url) return '';
  if (url.startsWith('//')) url = `https:${url}`;
  const subtitle = await getJson(url);
  const body = Array.isArray(subtitle?.body) ? subtitle.body : [];
  const lines = body
    .map((line: any) => {
      const text = String(line?.content ?? '').replace(/\s+/g, ' ').trim();
      if (!text) return '';
      const seconds = Math.max(0, Math.floor(Number(line?.from ?? 0)));
      return `[${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}] ${text}`;
    })
    .filter(Boolean);
  return lines.join('\n').slice(0, 9000);
}

async function videoInfo(bvid: string): Promise<VideoInfo | null> {
  const data = await getJson(
    `https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(bvid)}`
  );
  if (Number(data?.code) !== 0 || !data?.data) return null;
  const video = data.data;
  const cid = Number(video?.pages?.[0]?.cid ?? video?.cid ?? 0);
  if (!cid) return null;
  let transcript = '';
  try {
    transcript = await subtitleText(bvid, cid);
  } catch {
    transcript = '';
  }
  return {
    bvid,
    url: `https://www.bilibili.com/video/${bvid}`,
    title: String(video?.title ?? bvid).slice(0, 200),
    author: String(video?.owner?.name ?? '').slice(0, 80),
    description: String(video?.desc ?? '').replace(/\s+/g, ' ').trim().slice(0, 2000),
    duration: Number(video?.duration ?? 0),
    cid,
    transcript,
    hasSubtitle: Boolean(transcript)
  };
}

/**
 * Search Bilibili videos and pull their creator/CC subtitles when available.
 * Discovery uses the same DeepSeek Search API as web research; subtitles come
 * from Bilibili's public player endpoint. No login, downloads or media files.
 */
export async function searchBilibiliVideos(
  question: string,
  limit = 2
): Promise<ResearchSource[]> {
  const query = `${question.slice(0, 90)} site:bilibili.com/video`;
  const results = await searchWeb(query, 8);
  const seen = new Set<string>();
  const bvids: string[] = [];
  for (const result of results) {
    if (!isVideoUrl(result.url)) continue;
    const bvid = bvidOf(result.url);
    if (!bvid || seen.has(bvid)) continue;
    seen.add(bvid);
    bvids.push(bvid);
    if (bvids.length >= Math.max(1, limit)) break;
  }

  const sources: ResearchSource[] = [];
  for (const bvid of bvids) {
    try {
      const info = await videoInfo(bvid);
      if (!info) continue;
      const excerpt = info.hasSubtitle
        ? `视频字幕（B站，${info.author || '未知作者'}）：\n${info.transcript}`
        : `视频简介（B站，${info.author || '未知作者'}，暂无字幕）：\n${info.description}`;
      sources.push({
        title: info.title,
        url: info.url,
        siteName: 'B站',
        type: 'video',
        snippet: info.description.slice(0, 300),
        excerpt,
        authority: 2,
        fetched: info.hasSubtitle
      });
    } catch {
      // A single blocked video should not kill the whole research step.
    }
  }
  return sources;
}

export function isBilibiliVideo(url: string): boolean {
  return isVideoUrl(url) && Boolean(bvidOf(url));
}
