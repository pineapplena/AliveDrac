import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.ALIVE_DATA_DIR = mkdtempSync(join(tmpdir(), 'alive-live-'));
process.env.DEEPSEEK_API_KEY = '';

const settings = await import('../server/settings.js');
const live = await import('../server/live.js');

test('the live assistant is an opt-in extension', async () => {
  settings.saveSettings({ liveAssistant: { installed: false } });
  const initial = live.getLiveView();
  assert.equal(initial.installed, false);
  assert.equal(initial.settings.installed, false);
  assert.equal(initial.status, 'disconnected');

  const installed = live.installLiveAssistant(true);
  assert.equal(installed.installed, true);
  assert.equal(installed.settings.installed, true);
});

test('live settings are normalized and the cookie stays private', () => {
  const view = live.updateLiveSettings({
    roomId: 'https://live.bilibili.com/123456?x=1',
    streamerName: '主播',
    cookie: 'SESSDATA=secret; bili_jct=csrf',
    autoReply: true,
    replyMode: 'send',
    autoReplyCooldownSec: 1,
    maxPerMinute: 99,
    maxReplyChars: 500,
    moderationHints: true
  });
  assert.equal(view.settings.roomId, '123456');
  assert.equal(view.settings.autoReplyCooldownSec, 5);
  assert.equal(view.settings.maxPerMinute, 30);
  assert.equal(view.settings.maxReplyChars, 200);
  assert.equal(view.settings.replyMode, 'send');
  assert.equal(view.settings.hasCookie, true);
  assert.equal('cookie' in view.settings, false);
  assert.equal(settings.publicSettings().liveAssistant.hasCookie, true);

  const merged = live.updateLiveSettings({
    cookieFields: {
      sessdata: 'new-sess',
      biliJct: 'new-csrf',
      buvid3: 'new-buvid3'
    }
  });
  assert.equal(merged.settings.hasSessdata, true);
  assert.equal(merged.settings.hasBiliJct, true);
  assert.equal(merged.settings.hasBuvid3, true);
  assert.equal(merged.settings.hasBuvid4, false);
  const rawCookie = settings.getSettings().liveAssistant.cookie;
  assert.match(rawCookie, /SESSDATA=new-sess/);
  assert.match(rawCookie, /bili_jct=new-csrf/);
  assert.match(rawCookie, /buvid3=new-buvid3/);
  assert.doesNotMatch(JSON.stringify(settings.publicSettings()), /new-sess|new-csrf/);

  const extra = live.updateLiveSettings({
    cookieFields: { extra: 'buvid4=extra-buvid4; DedeUserID=42' }
  });
  assert.equal(extra.settings.hasBuvid4, true);
  assert.equal(extra.settings.hasDedeUserId, true);

  const noLearning = live.updateLiveSettings({ learnFromDanmaku: false });
  assert.equal(noLearning.settings.learnFromDanmaku, false);
});

test('moderation hints catch ads, links and attacks', () => {
  assert.ok(live.moderationFlags('加微信领福利').includes('广告'));
  assert.ok(live.moderationFlags('看这个 https://spam.example').includes('链接'));
  assert.ok(live.moderationFlags('你真傻逼').includes('攻击性'));
  assert.deepEqual(live.moderationFlags('主播今天状态不错'), []);
});

test('gift payloads are normalized from both SEND_GIFT and COMBO_SEND fields', () => {
  const sent = live.parseGiftData({
    uid: 42,
    uname: '观众A',
    giftName: '小花花',
    num: 3,
    price: 100,
    action: '投喂'
  });
  assert.deepEqual(sent, {
    uid: '42',
    uname: '观众A',
    giftName: '小花花',
    num: 3,
    price: 300,
    action: '投喂'
  });

  const combo = live.parseGiftData({
    uid: 43,
    uname: '观众B',
    gift_name: '辣条',
    combo_num: 5,
    total_coin: 500
  });
  assert.equal(combo.giftName, '辣条');
  assert.equal(combo.num, 5);
  assert.equal(combo.price, 500);

  const nested = live.parseGiftData({
    batch_combo_id: 'batch:1',
    batch_combo_send: {
      uid: 44,
      uname: '观众C',
      gift_name: '小花花',
      gift_num: 2
    }
  });
  assert.equal(nested.uid, '44');
  assert.equal(nested.uname, '观众C');
  assert.equal(nested.giftName, '小花花');
  assert.equal(nested.num, 2);
});

test('live knowledge is scoped by room and can be cleared', () => {
  const first = live.upsertLiveKnowledge({
    roomId: '123456',
    topic: '当前游戏',
    content: '主播在打只狼，正在打苇名弦一郎。',
    confidence: 0.9
  });
  assert.ok(first);
  assert.equal(live.getLiveKnowledge('123456').length, 1);
  assert.equal(live.getLiveKnowledge('654321').length, 0);

  live.upsertLiveKnowledge({
    roomId: '123456',
    topic: '当前游戏',
    content: '主播在打只狼，正在打苇名弦一郎。',
    confidence: 0.8
  });
  const entries = live.getLiveKnowledge('123456');
  assert.equal(entries.length, 1);
  assert.equal(entries[0].sourceCount, 2);

  live.clearLiveKnowledge('123456');
  assert.equal(live.getLiveKnowledge('123456').length, 0);
});

test('uninstalling stops the extension and removes its cookie', () => {
  const view = live.installLiveAssistant(false);
  assert.equal(view.installed, false);
  assert.equal(view.settings.installed, false);
  assert.equal(view.settings.hasCookie, false);
  assert.equal(settings.getSettings().liveAssistant.enabled, false);
});
