import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import http from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.ALIVE_DATA_DIR = mkdtempSync(join(tmpdir(), 'alive-vision-'));

const server = http.createServer(async (req, res) => {
  let body = '';
  for await (const chunk of req) body += chunk;
  const parsed = JSON.parse(body);
  const user = parsed.messages?.at(-1);
  const imageCount = Array.isArray(user?.content)
    ? user.content.filter((part: any) => part.type === 'image_url').length
    : 0;
  assert.equal(imageCount >= 1, true);
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(
    JSON.stringify({
      choices: [
        {
          message: {
            content: JSON.stringify({
              summary: '一张蓝色背景的小图，上面有一个白色的圆形。',
              visible_text: 'TEST',
              mood: '安静',
              intent: '想让我看看这张图',
              safety: 'safe',
              identity: imageCount > 1 ? 'self' : 'uncertain',
              identity_confidence: imageCount > 1 ? 0.88 : 0,
              identity_evidence: imageCount > 1 ? '发色、眼罩和龙角吻合' : ''
            })
          }
        }
      ],
      usage: { prompt_tokens: 40, completion_tokens: 20, total_tokens: 60 }
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
    apiKey: 'vision-test',
    model: 'fake-vl',
    maxTokens: 200
  }
});

const uploads = await import('../server/uploads.js');
const memory = await import('../server/memory.js');
const character = await import('../server/character.js');

const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2ZQAAAABJRU5ErkJggg==';

test('a reference image is seeded from the avatar and can be managed', () => {
  assert.ok(character.getCharacter().references.length >= 1);
  const reference = character.addCharacterReference(
    `data:image/png;base64,${PNG}`,
    '测试正脸',
    'char-main'
  );
  assert.equal(reference.caption, '测试正脸');
  assert.ok(character.getCharacter().references.length >= 2);
  character.deleteCharacterReference(reference.id, 'char-main');
  assert.equal(
    character.getCharacter().references.some((item) => item.id === reference.id),
    false
  );
});

test('upload stores a local image and can be analyzed', async () => {
  const attachment = uploads.saveUpload({
    dataUrl: `data:image/png;base64,${PNG}`,
    name: 'test.png',
    width: 1,
    height: 1
  });
  assert.ok(attachment.url.startsWith('/assets/uploads/'));
  assert.equal(attachment.vision, null);
  const analyzed = await uploads.analyzeUpload(attachment, '看看这个');
  assert.ok(analyzed.vision);
  assert.equal(analyzed.vision?.safety, 'safe');
  assert.ok(analyzed.vision?.summary.includes('蓝色'));
  assert.equal(analyzed.vision?.identity, 'self');
  assert.ok((analyzed.vision?.identityConfidence ?? 0) > 0.8);
  assert.notEqual(analyzed.vision?.referenceSignature, 'none');

  const message = memory.createMessage({
    role: 'user',
    content: '看看这个',
    segments: ['看看这个'],
    meta: { attachments: [analyzed] }
  });
  const loaded = memory.getMessage(message.id);
  assert.equal(loaded?.attachments.length, 1);
  assert.equal(loaded?.attachments[0].vision?.safety, 'safe');
});

test.after(() => server.close());
