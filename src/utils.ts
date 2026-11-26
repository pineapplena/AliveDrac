export function cn(...values: (string | false | null | undefined)[]): string {
  return values.filter(Boolean).join(' ');
}

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

export function clock(ts: number): string {
  return new Date(ts).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
}

export function dayLabel(ts: number): string {
  const date = new Date(ts);
  return `${date.getMonth() + 1}月${date.getDate()}日 ${WEEKDAYS[date.getDay()]}`;
}

export function shortDate(ts: number): string {
  const date = new Date(ts);
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

export function dateTime(ts: number): string {
  return `${shortDate(ts)} ${clock(ts)}`;
}

export function relative(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  return `${Math.floor(diff / 86_400_000)} 天前`;
}

export function hm(minutes: number): string {
  const value = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
}

export function pct(value: number): number {
  return Math.round(Math.min(1, Math.max(0, value)) * 100);
}

export function moodLabel(value: number): string {
  if (value < -0.45) return '低落';
  if (value < -0.12) return '有点闷';
  if (value < 0.22) return '平静';
  if (value < 0.5) return '还不错';
  return '心情很好';
}

export function energyLabel(value: number): string {
  if (value < 0.2) return '快没电了';
  if (value < 0.4) return '有点累';
  if (value < 0.7) return '还行';
  return '精神不错';
}

export function hungerLabel(value: number): string {
  if (value < 0.25) return '刚吃过';
  if (value < 0.5) return '不饿';
  if (value < 0.72) return '有点想吃东西';
  return '饿了';
}

export function stressLabel(value: number): string {
  if (value < 0.2) return '松弛';
  if (value < 0.45) return '正常';
  if (value < 0.7) return '有点紧';
  return '压力很大';
}

export interface CategoryInfo {
  label: string;
  color: string;
  soft: string;
}

export function categoryInfo(category: string): CategoryInfo {
  switch (category) {
    case 'sleep':
      return { label: '睡眠', color: '#8f9bd6', soft: 'rgba(143,155,214,.16)' };
    case 'meal':
      return { label: '吃饭', color: '#e2b070', soft: 'rgba(226,176,112,.16)' };
    case 'work':
      return { label: '工作', color: '#7fbfae', soft: 'rgba(127,191,174,.14)' };
    case 'rest':
      return { label: '休息', color: '#b7a6e8', soft: 'rgba(183,166,232,.15)' };
    case 'leisure':
      return { label: '自己的时间', color: '#e39db7', soft: 'rgba(227,157,183,.14)' };
    case 'study':
      return { label: '阅读', color: '#9db7e8', soft: 'rgba(157,183,232,.14)' };
    case 'commute':
      return { label: '路上', color: '#a9b4c2', soft: 'rgba(169,180,194,.12)' };
    case 'routine':
      return { label: '生活', color: '#c9b39a', soft: 'rgba(201,179,154,.13)' };
    case 'exercise':
      return { label: '活动', color: '#9fcf9b', soft: 'rgba(159,207,155,.14)' };
    default:
      return { label: '日常', color: '#9aa3b2', soft: 'rgba(154,163,178,.12)' };
  }
}

export const MEMORY_KINDS: Record<string, { label: string; color: string; hint: string }> = {
  core: { label: '核心', color: '#e8b06a', hint: '每轮都会带着' },
  fact: { label: '事实', color: '#9db7e8', hint: '稳定的事实' },
  preference: { label: '偏好', color: '#e2b070', hint: '喜欢与不喜欢' },
  event: { label: '事件', color: '#7fbfae', hint: '发生过的事' },
  promise: { label: '承诺', color: '#e39db7', hint: '还没完成的事' },
  relationship: { label: '关系', color: '#c7a6e8', hint: '关系里的节点' },
  emotion: { label: '情绪', color: '#d9a08e', hint: '只影响语气' },
  self: { label: '自我', color: '#a9b4c2', hint: '她自己的生活' },
  summary: { label: '阶段', color: '#b8b09a', hint: '一段时间的概括' }
};

export function memoryKind(kind: string) {
  return MEMORY_KINDS[kind] ?? { label: kind, color: '#9aa3b2', hint: '' };
}

export function segmentsOf(text: string): string[] {
  const parts = text
    .split(/\n\s*---\s*\n/)
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.length ? parts : [text];
}

export function stageIndex(stage: string, stages: string[]): number {
  const index = stages.indexOf(stage);
  return index < 0 ? 0 : index;
}
