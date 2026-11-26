import { db } from './db.js';
import { getCharacter } from './character.js';
import { getProactiveRecords, proactiveStats } from './proactive.js';
import { memoryStats } from './memory.js';
import { nowMs } from './time.js';

type Row = Record<string, any>;

export function getStats(): {
  messages: number;
  userMessages: number;
  proactiveSent: number;
  memories: ReturnType<typeof memoryStats>;
  proactive: ReturnType<typeof proactiveStats>;
  usage: {
    today: { calls: number; tokens: number };
    week: { calls: number; tokens: number };
    total: { calls: number; tokens: number };
    recent: { task: string; model: string; totalTokens: number; ok: boolean; createdAt: number }[];
  };
  recentProactive: ReturnType<typeof getProactiveRecords>;
} {
  const character = getCharacter();
  const count = (sql: string, ...params: any[]) => {
    const row = db.prepare(sql).get(...params) as Row;
    return Number(row?.n ?? 0);
  };
  const usageRows = db
    .prepare(
      `SELECT task, model, total_tokens, ok, created_at FROM llm_usage
       WHERE created_at >= ? ORDER BY created_at DESC LIMIT 500`
    )
    .all(nowMs() - 7 * 86_400_000) as Row[];
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const today = usageRows.filter((row) => Number(row.created_at) >= todayStart.getTime());
  const sum = (rows: Row[]) => ({
    calls: rows.length,
    tokens: rows.reduce((total, row) => total + Number(row.total_tokens ?? 0), 0)
  });
  return {
    messages: count('SELECT COUNT(*) AS n FROM messages WHERE conversation_id = ?', 'conv-main'),
    userMessages: count(
      "SELECT COUNT(*) AS n FROM messages WHERE conversation_id = ? AND role = 'user'",
      'conv-main'
    ),
    proactiveSent: count(
      "SELECT COUNT(*) AS n FROM proactive_messages WHERE character_id = ? AND status = 'sent'",
      character.id
    ),
    memories: memoryStats(),
    proactive: proactiveStats(),
    usage: {
      today: sum(today),
      week: sum(usageRows),
      total: {
        calls: count('SELECT COUNT(*) AS n FROM llm_usage'),
        tokens: count('SELECT COALESCE(SUM(total_tokens), 0) AS n FROM llm_usage')
      },
      recent: usageRows.slice(0, 12).map((row) => ({
        task: String(row.task),
        model: String(row.model),
        totalTokens: Number(row.total_tokens ?? 0),
        ok: Boolean(row.ok),
        createdAt: Number(row.created_at)
      }))
    },
    recentProactive: getProactiveRecords(8)
  };
}
