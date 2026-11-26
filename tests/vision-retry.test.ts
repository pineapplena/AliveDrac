import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import http from 'node:http';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.ALIVE_DATA_DIR = mkdtempSync(join(tmpdir(), 'alive-vision-retry-'));

let calls = 0;
const server = http.createServer(async (req, res) => {
  let body = '';
  for await (const chunk of req) body += chunk;
  calls++;
  const parsed = JSON.parse(body);
  res.writeHead(200, { 'Content-Type': 'application/json' });
  if (calls === 1) {
    assert.equal(parsed.max_tokens, 2000);
    res.end(
      JSON.stringify({
        choices: [{ finish_reason: 'length', message: { content: '' } }],
        usage: { prompt_tokens: 100, completion_tokens: 2000, total_tokens: 2100 }
      })
    );
    return;
  }
  assert.equal(parsed.max_tokens, 4000);
  assert.equal(parsed.response_format, undefined);
  res.end(
    JSON.stringify({
      choices: [
        {
          finish_reason: 'stop',
          message: {
            content: JSON.stringify({
              summary: '一张测试图片。',
              visible_text: '',
              mood: '安静',
              intent: '测试',
              safety: 'safe',
              identity: 'uncertain',
              identity_confidence: 0,
              identity_evidence: ''
            })
          }
        }
      ],
      usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 }
    })
  );
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const address = server.address();
const port = typeof address === 'object' && address ? address.port : 0;

const settings = await import('../server/settings.js');
settings.saveSettings({
  vision: {
    enabled: true,
    baseUrl: `http://127.0.0.1:${port}/v1`,
    apiKey: 'test',
    model: 'test-vl',
    maxTokens: 2000
  }
});
const { describeImage } = await import('../server/vision.js');
const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2ZQAAAABJRU5ErkJggg==';
const imagePath = join(process.env.ALIVE_DATA_DIR!, 'retry.png');
writeFileSync(imagePath, Buffer.from(PNG, 'base64'));

test('a reasoning-only vision response is retried instead of called a blurry image', async () => {
  const result = await describeImage(imagePath, 'image/png', '测试');
  assert.equal(result.summary, '一张测试图片。');
  assert.equal(calls, 2);
});

test.after(() => server.close());
