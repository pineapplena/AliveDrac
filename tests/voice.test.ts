import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.ALIVE_DATA_DIR = mkdtempSync(join(tmpdir(), 'alive-voice-'));

const settings = await import('../server/settings.js');
const voice = await import('../server/voice.js');

test('voice is disabled until enabled, keyed and given a voice id', () => {
  settings.saveSettings({
    voice: {
      enabled: false,
      apiKey: 'test-key',
      voiceId: 'voice-tone-test',
      probability: 1
    }
  });
  assert.equal(voice.voiceReady(), true);
  assert.equal(voice.voiceConfigured(), false);
  assert.equal(voice.shouldVoiceReply('你好呀'), false);

  settings.saveSettings({ voice: { enabled: true } });
  assert.equal(voice.voiceConfigured(), true);
  assert.equal(voice.shouldVoiceReply('你好呀'), true);
});

test('voice probability zero means text-only replies', () => {
  settings.saveSettings({ voice: { probability: 0 } });
  assert.equal(voice.planVoiceReply(), false);
  assert.equal(voice.shouldVoiceReply('今天想和你说件事'), false);
  settings.saveSettings({ voice: { probability: 1 } });
  assert.equal(voice.planVoiceReply(), true);
  assert.equal(voice.shouldVoiceReply('今天想和你说件事'), true);
});

test('parenthetical stage directions are removed from speech', () => {
  assert.equal(voice.cleanSpeechText('（小声）谢谢。', 120), '谢谢。');
  assert.equal(
    voice.cleanSpeechText('她停了一下（低头看手里的杯子），然后笑了。', 120),
    '她停了一下 ，然后笑了。'
  );
});

test('voice api key is not exposed in public settings', () => {
  const publicVoice = settings.publicSettings().voice;
  assert.equal(publicVoice.hasApiKey, true);
  assert.equal('apiKey' in publicVoice, false);
  assert.doesNotMatch(JSON.stringify(publicVoice), /test-key/);
});
