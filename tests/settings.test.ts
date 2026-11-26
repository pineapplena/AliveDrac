import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.ALIVE_DATA_DIR = mkdtempSync(join(tmpdir(), 'alive-settings-'));

const settings = await import('../server/settings.js');

test('semantic keys are stored but never exposed publicly', () => {
  settings.saveSettings({
    memory: {
      embedding: {
        enabled: true,
        baseUrl: 'http://127.0.0.1:9999/v1',
        model: 'test-embed',
        apiKey: 'secret-embed'
      },
      rerank: {
        enabled: true,
        baseUrl: 'http://127.0.0.1:9999/v1',
        model: 'test-rerank',
        apiKey: 'secret-rerank'
      }
    }
  });
  const stored = settings.getSettings();
  assert.equal(stored.memory.embedding.apiKey, 'secret-embed');
  const exposed = settings.publicSettings();
  assert.equal('apiKey' in exposed.memory.embedding, false);
  assert.equal('apiKey' in exposed.memory.rerank, false);
  assert.equal(exposed.memory.embedding.hasApiKey, true);
  assert.equal(exposed.memory.rerank.hasApiKey, true);
});

test('semantic settings keep normalization defaults', () => {
  const current = settings.getSettings();
  assert.equal(current.memory.embedding.batchSize, 16);
  assert.equal(current.memory.rerank.topN, 10);
});
