import { db, newId } from './db.js';
import { getSettings, llmConfigured } from './settings.js';
import { chunkText, mockChat, mockTask, type MockChatContext } from './mock.js';

export type LLMRole = 'system' | 'user' | 'assistant';
export interface LLMMessage {
  role: LLMRole;
  content: string;
}

export interface LLMOptions {
  task: string;
  system?: string;
  messages: LLMMessage[];
  json?: boolean;
  temperature?: number;
  maxTokens?: number;
  mockContext?: MockChatContext;
  mockPayload?: Record<string, any>;
  signal?: AbortSignal;
}

export interface LLMUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface LLMResult {
  text: string;
  model: string;
  usage: LLMUsage;
  mock: boolean;
}

export class LLMError extends Error {
  status: number;
  detail: string;
  constructor(message: string, status = 0, detail = '') {
    super(message);
    this.name = 'LLMError';
    this.status = status;
    this.detail = detail;
  }
}

function endpoint(baseUrl: string): string {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new LLMError('模型地址不是有效的 URL');
  }
  const path = url.pathname.replace(/\/+$/, '');
  if (path.endsWith('/chat/completions')) return url.toString();
  if (path.endsWith('/v1')) {
    url.pathname = `${path}/chat/completions`;
  } else {
    url.pathname = `${path}/v1/chat/completions`.replace(/\/+/g, '/');
  }
  return url.toString();
}

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 3));
}

export function recordUsage(
  task: string,
  model: string,
  usage: LLMUsage,
  ok: boolean,
  error: string | null = null
): void {
  db.prepare(
    `INSERT INTO llm_usage
      (id, task, model, prompt_tokens, completion_tokens, total_tokens, ok, error, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    newId('usage'),
    task,
    model,
    usage.promptTokens,
    usage.completionTokens,
    usage.totalTokens,
    ok ? 1 : 0,
    error,
    Date.now()
  );
}

function readTextContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part;
        if (part && typeof part === 'object' && 'text' in part) return String((part as any).text);
        return '';
      })
      .join('');
  }
  return '';
}

function mockDelay(): number {
  const n = Number(process.env.ALIVE_MOCK_STREAM_DELAY ?? 8);
  return Number.isFinite(n) ? Math.max(0, n) : 8;
}

function mockFor(options: LLMOptions): string {
  if (options.task === 'chat' && options.mockContext) {
    return mockChat(options.mockContext);
  }
  if (options.task === 'proactive' && options.mockPayload) {
    return mockTask('proactive', options.mockPayload);
  }
  return mockTask(options.task, options.mockPayload ?? {});
}

function mockResult(options: LLMOptions, text: string): LLMResult {
  const prompt = [options.system ?? '', ...options.messages.map((m) => m.content)].join('\n');
  return {
    text,
    model: 'offline-demo',
    usage: {
      promptTokens: estimateTokens(prompt),
      completionTokens: estimateTokens(text),
      totalTokens: estimateTokens(prompt) + estimateTokens(text)
    },
    mock: true
  };
}

async function requestChat(
  body: Record<string, unknown>,
  apiKey: string,
  baseUrl: string,
  signal: AbortSignal | undefined,
  stream: boolean
): Promise<Response> {
  const timeout = AbortSignal.timeout(120_000);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  let lastError: unknown;

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetch(endpoint(baseUrl), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: stream ? 'text/event-stream' : 'application/json',
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify(body),
        signal: combined
      });
      if (response.ok) return response;

      const detail = (await response.text().catch(() => '')).slice(0, 600);
      if (response.status === 429 || response.status >= 500) {
        lastError = new LLMError(`模型服务暂时不可用（${response.status}）`, response.status, detail);
        if (attempt === 0) {
          await new Promise((resolve) => setTimeout(resolve, 600));
          continue;
        }
      }
      throw new LLMError(`模型请求失败（${response.status}）`, response.status, detail);
    } catch (error) {
      if (error instanceof LLMError) throw error;
      lastError = error;
      if (attempt === 0) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        continue;
      }
    }
  }
  const message = lastError instanceof Error ? lastError.message : '模型请求失败';
  throw new LLMError(message, 0, String(lastError ?? ''));
}

export async function complete(options: LLMOptions): Promise<LLMResult> {
  const settings = getSettings();
  if (!llmConfigured() || settings.provider.mock) {
    const text = mockFor(options);
    if (!text) throw new LLMError('离线演示模式暂不支持这个任务');
    const result = mockResult(options, text);
    recordUsage(options.task, result.model, result.usage, true);
    return result;
  }

  const messages = options.system
    ? [{ role: 'system' as const, content: options.system }, ...options.messages]
    : options.messages;
  const body: Record<string, unknown> = {
    model: settings.provider.model,
    messages,
    temperature: options.temperature ?? settings.provider.temperature,
    max_tokens: options.maxTokens ?? settings.provider.maxTokens,
    stream: false
  };
  if (options.json) body.response_format = { type: 'json_object' };

  let response: Response;
  try {
    response = await requestChat(
      body,
      settings.provider.apiKey,
      settings.provider.baseUrl,
      options.signal,
      false
    );
  } catch (error) {
    if (options.json && error instanceof LLMError && error.status === 400) {
      delete body.response_format;
      response = await requestChat(
        body,
        settings.provider.apiKey,
        settings.provider.baseUrl,
        options.signal,
        false
      );
    } else {
      const usage = {
        promptTokens: estimateTokens(JSON.stringify(messages)),
        completionTokens: 0,
        totalTokens: estimateTokens(JSON.stringify(messages))
      };
      recordUsage(options.task, settings.provider.model, usage, false, String(error));
      throw error;
    }
  }

  const data = (await response.json()) as any;
  const text = readTextContent(data?.choices?.[0]?.message?.content);
  if (!text) {
    const usage = {
      promptTokens: estimateTokens(JSON.stringify(messages)),
      completionTokens: 0,
      totalTokens: estimateTokens(JSON.stringify(messages))
    };
    recordUsage(options.task, settings.provider.model, usage, false, 'empty response');
    throw new LLMError('模型返回了空内容');
  }
  const usage: LLMUsage = {
    promptTokens: Number(data?.usage?.prompt_tokens ?? 0) || estimateTokens(JSON.stringify(messages)),
    completionTokens: Number(data?.usage?.completion_tokens ?? 0) || estimateTokens(text),
    totalTokens: Number(data?.usage?.total_tokens ?? 0) || 0
  };
  if (!usage.totalTokens) usage.totalTokens = usage.promptTokens + usage.completionTokens;
  recordUsage(options.task, settings.provider.model, usage, true);
  return { text, model: settings.provider.model, usage, mock: false };
}

export async function* streamText(options: LLMOptions): AsyncGenerator<string, LLMResult, void> {
  const settings = getSettings();
  const promptEstimate = estimateTokens(
    [options.system ?? '', ...options.messages.map((m) => m.content)].join('\n')
  );

  if (!llmConfigured() || settings.provider.mock) {
    const text = mockFor(options);
    if (!text) throw new LLMError('离线演示模式暂不支持这个任务');
    for (const part of chunkText(text)) {
      if (mockDelay() > 0) await new Promise((resolve) => setTimeout(resolve, mockDelay()));
      yield part;
    }
    const result = mockResult(options, text);
    recordUsage(options.task, result.model, result.usage, true);
    return result;
  }

  const messages = options.system
    ? [{ role: 'system' as const, content: options.system }, ...options.messages]
    : options.messages;
  const body: Record<string, unknown> = {
    model: settings.provider.model,
    messages,
    temperature: options.temperature ?? settings.provider.temperature,
    max_tokens: options.maxTokens ?? settings.provider.maxTokens,
    stream: true,
    stream_options: { include_usage: true }
  };

  let response: Response;
  try {
    try {
      response = await requestChat(
        body,
        settings.provider.apiKey,
        settings.provider.baseUrl,
        options.signal,
        true
      );
    } catch (error) {
      // Some OpenAI-compatible providers reject stream_options; retry without it.
      if (error instanceof LLMError && error.status === 400 && body.stream_options) {
        delete body.stream_options;
        response = await requestChat(
          body,
          settings.provider.apiKey,
          settings.provider.baseUrl,
          options.signal,
          true
        );
      } else {
        throw error;
      }
    }
  } catch (error) {
    recordUsage(
      options.task,
      settings.provider.model,
      { promptTokens: promptEstimate, completionTokens: 0, totalTokens: promptEstimate },
      false,
      String(error)
    );
    throw error;
  }

  if (!response.body) throw new LLMError('模型没有返回可读取的数据流');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let full = '';
  let usage: LLMUsage | null = null;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let index = buffer.indexOf('\n');
      while (index >= 0) {
        const raw = buffer.slice(0, index).replace(/\r$/, '');
        buffer = buffer.slice(index + 1);
        if (raw.startsWith('data:')) {
          const payload = raw.slice(5).trim();
          if (payload && payload !== '[DONE]') {
            try {
              const chunk = JSON.parse(payload) as any;
              const delta = readTextContent(chunk?.choices?.[0]?.delta?.content);
              if (delta) {
                full += delta;
                yield delta;
              }
              if (chunk?.usage) {
                usage = {
                  promptTokens: Number(chunk.usage.prompt_tokens ?? 0),
                  completionTokens: Number(chunk.usage.completion_tokens ?? 0),
                  totalTokens: Number(chunk.usage.total_tokens ?? 0)
                };
              }
            } catch {
              // Ignore malformed keep-alive lines.
            }
          }
        }
        index = buffer.indexOf('\n');
      }
    }
  } finally {
    reader.releaseLock();
  }

  if (!full.trim()) {
    recordUsage(
      options.task,
      settings.provider.model,
      { promptTokens: promptEstimate, completionTokens: 0, totalTokens: promptEstimate },
      false,
      'empty stream'
    );
    throw new LLMError('模型流式返回了空内容');
  }

  const finalUsage: LLMUsage = usage ?? {
    promptTokens: promptEstimate,
    completionTokens: estimateTokens(full),
    totalTokens: promptEstimate + estimateTokens(full)
  };
  if (!finalUsage.totalTokens) finalUsage.totalTokens = finalUsage.promptTokens + finalUsage.completionTokens;
  recordUsage(options.task, settings.provider.model, finalUsage, true);
  return { text: full, model: settings.provider.model, usage: finalUsage, mock: false };
}

export function parseJsonLoose<T>(text: string): T {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    const first = cleaned.indexOf('{');
    const last = cleaned.lastIndexOf('}');
    if (first >= 0 && last > first) {
      return JSON.parse(cleaned.slice(first, last + 1)) as T;
    }
    throw new Error('模型返回的 JSON 无法解析');
  }
}
