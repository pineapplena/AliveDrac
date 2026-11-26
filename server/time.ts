const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

export function nowMs(): number {
  return Date.now();
}

export function partsInZone(ts: number, timeZone: string) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    weekday: 'short',
    hour12: false
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(new Date(ts)).map((part) => [part.type, part.value])
  ) as Record<string, string>;
  const hour = Number(parts.hour === '24' ? '0' : parts.hour);
  const minute = Number(parts.minute);
  const weekdayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6
  };
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour,
    minute,
    second: Number(parts.second),
    weekday: weekdayMap[parts.weekday] ?? 0,
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: hour * 60 + minute
  };
}

export function dateKey(ts: number, timeZone: string): string {
  return partsInZone(ts, timeZone).date;
}

export function minutesOfDay(ts: number, timeZone: string): number {
  return partsInZone(ts, timeZone).minutes;
}

export function weekdayName(weekday: number): string {
  return WEEKDAYS[weekday] ?? '';
}

export function dateLabel(date: string, timeZone: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const guess = Date.UTC(y, m - 1, d, 4, 0, 0);
  const wd = partsInZone(guess, timeZone).weekday;
  return `${m}月${d}日 ${WEEKDAYS[wd]}`;
}

export function addDays(date: string, delta: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + delta);
  return dt.toISOString().slice(0, 10);
}

export function hmToMinutes(value: string): number {
  const [h, m] = value.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

export function minutesToHM(value: number): string {
  const total = ((Math.round(value) % 1440) + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

export function zonedDateTimeToMs(date: string, minutes: number, timeZone: string): number {
  const [year, month, day] = date.split('-').map(Number);
  const base = Date.UTC(year, month - 1, day) + Math.round(minutes) * 60_000;
  let guess = base;
  for (let attempt = 0; attempt < 2; attempt++) {
    const p = partsInZone(guess, timeZone);
    const localAsUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
    const offset = localAsUtc - guess;
    guess = base - offset;
  }
  return guess;
}

export function formatClock(ts: number, timeZone: string): string {
  const p = partsInZone(ts, timeZone);
  return `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
}

export function dayPhase(hour: number): string {
  if (hour < 5) return '凌晨';
  if (hour < 8) return '清晨';
  if (hour < 11) return '上午';
  if (hour < 13) return '中午';
  if (hour < 17) return '下午';
  if (hour < 19) return '傍晚';
  if (hour < 23) return '晚上';
  return '深夜';
}

export function formatDateTime(ts: number, timeZone: string): string {
  const p = partsInZone(ts, timeZone);
  return `${p.month}月${p.day}日 ${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
}

export function relativeTime(ts: number, timeZone: string): string {
  const diff = Math.max(0, Date.now() - ts);
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} 天前`;
  return formatDateTime(ts, timeZone);
}

export function gapLabel(ms: number): string {
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时`;
  return `${Math.floor(hours / 24)} 天`;
}

export function isQuietNow(
  quietStart: string,
  quietEnd: string,
  ts: number,
  timeZone: string
): boolean {
  const start = hmToMinutes(quietStart);
  const end = hmToMinutes(quietEnd);
  if (start === end) return false;
  const cur = minutesOfDay(ts, timeZone);
  if (start < end) return cur >= start && cur < end;
  return cur >= start || cur < end;
}

export function safeTimeZone(value: string | undefined): string {
  if (!value) return 'Asia/Shanghai';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format(new Date());
    return value;
  } catch {
    return 'Asia/Shanghai';
  }
}
