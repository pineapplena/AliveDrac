import { randomUUID } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
  unlinkSync,
  writeFileSync
} from 'node:fs';
import { join, resolve } from 'node:path';
import type { VoiceAttachment } from '../shared/types.js';
import { ASSETS_DIR } from './config.js';
import { updateMessageMeta } from './memory.js';
import { getSettings } from './settings.js';
import { nowMs } from './time.js';

const VOICE_DIR = resolve(ASSETS_DIR, 'voice');
const MAX_FILE_BYTES = 8 * 1024 * 1024;

function voiceKey(config: { baseUrl: string; apiKey: string }): string {
  if (config.apiKey) return config.apiKey;
  const settings = getSettings();
  try {
    if (new URL(config.baseUrl).origin === new URL(settings.provider.baseUrl).origin) {
      return settings.provider.apiKey;
    }
  } catch {
    // The request builder reports invalid URLs.
  }
  return '';
}

export function voiceReady(): boolean {
  const config = getSettings().voice;
  return Boolean(config.baseUrl && config.model && config.voiceId && voiceKey(config));
}

export function voiceConfigured(): boolean {
  return Boolean(getSettings().voice.enabled && voiceReady());
}

function speechEndpoint(baseUrl: string): string {
  const url = new URL(baseUrl);
  const path = url.pathname.replace(/\/+$/, '');
  if (path.endsWith('/audio/speech')) return url.toString();
  if (path.endsWith('/v1')) url.pathname = `${path}/audio/speech`;
  else url.pathname = `${path}/v1/audio/speech`.replace(/\/+/g, '/');
  return url.toString();
}

export function cleanSpeechText(text: string, maxChars: number): string {
  let clean = String(text ?? '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/（[^（）]{1,160}）/g, ' ')
    .replace(/\([^()]{1,160}\)/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/[*_#>~|]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (clean.length > maxChars) {
    clean = clean.slice(0, maxChars);
    const cut = Math.max(
      clean.lastIndexOf('。'),
      clean.lastIndexOf('！'),
      clean.lastIndexOf('？'),
      clean.lastIndexOf('，'),
      clean.lastIndexOf('.')
    );
    if (cut >= Math.floor(maxChars * 0.55)) clean = clean.slice(0, cut + 1);
    else clean = `${clean}…`;
  }
  return clean;
}

function cleanupVoiceFiles(): void {
  try {
    if (!existsSync(VOICE_DIR)) return;
    const files = readdirSync(VOICE_DIR)
      .filter((name) => name.endsWith('.mp3'))
      .map((name) => ({ name, path: join(VOICE_DIR, name), mtime: statSync(join(VOICE_DIR, name)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);
    const cutoff = Date.now() - 14 * 86_400_000;
    files.forEach((file, index) => {
      if (index >= 200 || file.mtime < cutoff) {
        try {
          unlinkSync(file.path);
        } catch {
          // Best effort.
        }
      }
    });
  } catch {
    // Cleanup must not block speech.
  }
}

export async function synthesizeVoice(
  text: string,
  options: { timeoutMs?: number; maxChars?: number; force?: boolean } = {}
): Promise<VoiceAttachment> {
  const settings = getSettings().voice;
  const apiKey = voiceKey(settings);
  if ((!settings.enabled && !options.force) || !apiKey || !settings.voiceId) {
    throw new Error('语音模型还没有配置');
  }
  const input = cleanSpeechText(text, options.maxChars ?? settings.maxChars);
  if (input.length < 2) throw new Error('这段话太短，没法读出来');
  if (!existsSync(VOICE_DIR)) mkdirSync(VOICE_DIR, { recursive: true });
  let response: Response;
  try {
    response = await fetch(speechEndpoint(settings.baseUrl), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: settings.model,
        input,
        voice: settings.voiceId,
        speed: settings.speed,
        response_format: 'mp3'
      }),
      signal: AbortSignal.timeout(options.timeoutMs ?? 30_000)
    });
  } catch (error) {
    throw new Error(
      `语音服务连接失败：${error instanceof Error ? error.message : String(error)}`
    );
  }
  if (!response.ok) {
    const detail = (await response.text().catch(() => '')).slice(0, 300);
    throw new Error(`语音合成失败（${response.status}）${detail ? `：${detail}` : ''}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  if (!buffer.length) throw new Error('语音服务返回了空音频');
  if (buffer.length > MAX_FILE_BYTES) throw new Error('语音文件太大，已放弃保存');
  const fileName = `voice-${nowMs()}-${randomUUID().slice(0, 8)}.mp3`;
  writeFileSync(join(VOICE_DIR, fileName), buffer);
  cleanupVoiceFiles();
  return {
    url: `/assets/voice/${fileName}`,
    mime: 'audio/mpeg',
    voiceId: settings.voiceId,
    model: settings.model,
    createdAt: nowMs()
  };
}

export function planVoiceReply(): boolean {
  const settings = getSettings().voice;
  if (!voiceConfigured()) return false;
  if (settings.probability <= 0) return false;
  return Math.random() < settings.probability;
}

export function shouldVoiceReply(text: string): boolean {
  const settings = getSettings().voice;
  if (!voiceConfigured()) return false;
  if (settings.probability <= 0 || cleanSpeechText(text, settings.maxChars).length < 2) {
    return false;
  }
  return Math.random() < settings.probability;
}

export async function maybeAttachVoice(
  messageId: string,
  text: string
): Promise<VoiceAttachment | null> {
  if (!shouldVoiceReply(text)) return null;
  try {
    const voice = await synthesizeVoice(text);
    updateMessageMeta(messageId, { voice });
    return voice;
  } catch (error) {
    console.warn(
      '[voice] generate failed:',
      error instanceof Error ? error.message : String(error)
    );
    return null;
  }
}

export async function testVoice(text: string): Promise<VoiceAttachment> {
  return synthesizeVoice(text || '唔，我在。今天感觉怎么样？', { force: true });
}
