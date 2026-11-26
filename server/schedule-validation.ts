export interface ScheduleInput {
  blocks?: {
    start?: number;
    end?: number;
    startMin?: number;
    endMin?: number;
    activity?: string;
    location?: string;
    category?: string;
    detail?: string;
    shareable?: boolean;
  }[];
}

export interface NormalizedBlock {
  startMin: number;
  endMin: number;
  activity: string;
  location: string;
  category: string;
  detail: string;
  shareable: boolean;
}

const CATEGORIES = new Set([
  'sleep',
  'routine',
  'meal',
  'work',
  'rest',
  'leisure',
  'commute',
  'study',
  'exercise',
  'other'
]);

export function normalizeBlocks(input: ScheduleInput): NormalizedBlock[] {
  const raw = Array.isArray(input.blocks) ? input.blocks : [];
  const cleaned = raw
    .map((block) => ({
      startMin: Math.round(Number(block.start ?? block.startMin ?? -1)),
      endMin: Math.round(Number(block.end ?? block.endMin ?? -1)),
      activity: String(block.activity ?? '').trim().slice(0, 40),
      location: String(block.location ?? '').trim().slice(0, 60),
      category: CATEGORIES.has(String(block.category)) ? String(block.category) : 'other',
      detail: String(block.detail ?? '').trim().slice(0, 200),
      shareable: Boolean(block.shareable)
    }))
    .filter(
      (block) =>
        Number.isFinite(block.startMin) &&
        Number.isFinite(block.endMin) &&
        block.startMin >= 0 &&
        block.endMin <= 1440 &&
        block.endMin > block.startMin &&
        block.activity
    )
    .sort((a, b) => a.startMin - b.startMin);

  if (cleaned.length < 4) return [];
  const result: NormalizedBlock[] = [];
  for (const block of cleaned) {
    const previous = result.at(-1);
    if (previous && block.startMin < previous.endMin) {
      if (block.startMin <= previous.startMin) continue;
      block.startMin = previous.endMin;
    }
    if (block.endMin - block.startMin < 5) continue;
    result.push(block);
  }
  if (result.length < 4) return [];
  if (result[0].startMin > 0) {
    result.unshift({
      startMin: 0,
      endMin: result[0].startMin,
      activity: '睡着',
      location: '卧室',
      category: 'sleep',
      detail: '还在睡。',
      shareable: false
    });
  }
  const last = result.at(-1)!;
  if (last.endMin < 1440) {
    result.push({
      startMin: last.endMin,
      endMin: 1440,
      activity: '准备睡觉',
      location: '卧室',
      category: 'sleep',
      detail: '把灯关掉，慢慢睡着。',
      shareable: false
    });
  }
  return result;
}
