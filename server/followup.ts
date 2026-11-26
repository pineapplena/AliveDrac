import { createMemory, findSimilarPromise } from './memory.js';
import { nowMs } from './time.js';

const FUTURE_CUE =
  /明天|后天|周末|下周|下个月|回头|等会|晚点|到时候|下次|改天|过几天|今晚|下午|早上|等.{0,6}(再|一起|去|做)/;
const LOW_VALUE = /^(明天见|明天聊|改天聊|回头聊|晚安|早安|先这样)[。！!…\s]*$/;
const ASSISTANT_COMMIT =
  /(?:我|那)(?:会|来|去|帮|给|陪|带|查|弄|做|准备|留|等|接|找|买|写|改|安排|提醒)|我(?:明天|后天|周末|下周|回头|晚点|等会|下班后)|(?:明天|后天|周末|下周|回头|晚点|等会|下班后)[^。！？]{0,16}(?:我|帮|陪|给|带|查|弄|做|准备|留|等|接|找|买|写|改|安排|提醒)/;
const USER_REQUEST =
  /帮我|替我|陪我|提醒我|记得|说好|答应|约好|能不能|可以.{0,8}吗|你.{0,8}(?:明天|后天|周末|下周|回头|晚点|等会|下班后)/;
const USER_COMMIT =
  /我会|我答应|我保证|我一定|我明天|我后天|我周末|我下次|今晚我|明天我/;
const NEGATIVE_COMMIT =
  /帮不了|不能帮|没法帮|去不了|来不了|做不到|不陪|没空|没时间|不在|不来|不去|改不了/;
const AFFECTION = /晚安|早安|睡吧|好梦|抱抱|亲亲|想你|爱你|怀里|蹭|亲/;
const CONCRETE = /答应|约好|说好|提醒|帮你|帮您|陪你|明天|后天|周末|下次|回头|等会|下班后|晚点|到时候/;

/**
 * 从一轮对话里抓“之后还要接上的事”。
 *
 * 只有一方明确承诺/请求，并且确实指向未来时，才建立 promise；
 * 普通未来计划不建立未完成约定，避免把闲聊反复当成承诺来催。
 */
export function maybeCreateFollowUp(userText: string, assistantText: string): boolean {
  const text = userText.replace(/\s+/g, ' ').trim();
  const reply = assistantText.replace(/\s+/g, ' ').trim();
  if (!text || text.length > 800) return false;
  if (LOW_VALUE.test(text) || (reply && LOW_VALUE.test(reply))) return false;
  const combined = `${text}\n${reply}`;
  if (AFFECTION.test(combined) && !CONCRETE.test(combined)) return false;
  const userPromise = USER_COMMIT.test(text);
  if (!FUTURE_CUE.test(combined) && !userPromise) return false;

  const committed =
    (USER_REQUEST.test(text) || userPromise || ASSISTANT_COMMIT.test(reply)) &&
    (FUTURE_CUE.test(combined) || userPromise) &&
    !NEGATIVE_COMMIT.test(reply);
  if (!committed) return false;

  const content = `约定：${text.slice(0, 180)}\n我当时回应：${reply.slice(0, 180)}。`;
  const title = `约定：${text.slice(0, 18)}`;
  if (findSimilarPromise(`${text}\n${reply}`, undefined, title)) return false;

  createMemory({
    kind: 'promise',
    title,
    content,
    importance: 0.7,
    confidence: 0.72,
    valence: 0.1,
    source: 'followup',
    happenedAt: nowMs(),
    tags: ['未完成', '跟进', '约定'],
    meta: {
      followUp: true,
      dueHint: 'future',
      promiseFrom: ASSISTANT_COMMIT.test(reply) ? 'assistant' : 'user',
      cue: text.slice(0, 120)
    }
  });
  return true;
}
