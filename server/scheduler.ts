import { addDays, dateKey, nowMs, partsInZone } from './time.js';
import { getSettings } from './settings.js';
import { getState, tickLife, generateDiary, generateDream, getDiary, ensureSchedule } from './life.js';
import { decayMemories, maybeSummarize } from './memory.js';
import { refreshWeatherCache, runProactive, expireStaleProactive, expireStaleEvents } from './proactive.js';
import { getMeta, setMeta } from './db.js';
import { indexPending } from './memory-index.js';
import { canLearn, decayIdleInterests, runLearningSession } from './learning.js';
import { canChooseLeisure, runLeisure } from './leisure.js';
import { resumeLiveAssistant } from './live.js';
import { runScreenPeek } from './screen.js';
import { weeklyReviewTick } from './weekly-review.js';

let started = false;
let stopped = false;
const timers: NodeJS.Timeout[] = [];
const inFlight = new Set<string>();

async function guard(name: string, fn: () => Promise<void>): Promise<void> {
  if (stopped || inFlight.has(name)) return;
  inFlight.add(name);
  try {
    await fn();
  } catch (error) {
    console.warn(`[scheduler:${name}]`, error instanceof Error ? error.message : error);
  } finally {
    inFlight.delete(name);
  }
}

async function proactiveTick(): Promise<void> {
  const settings = getSettings();
  if (!settings.proactive.enabled) return;
  const result = await runProactive();
  if (result.sent) {
    console.log(`[proactive] sent (${result.candidate?.type}): ${result.reason}`);
  }
}

async function learningTick(): Promise<void> {
  const settings = getSettings();
  if (!settings.learning.enabled) return;
  const eligibility = canLearn(false);
  if (!eligibility.allowed) return;
  // Do not pounce on the first free minute every single time.
  if (Math.random() > 0.45) return;
  const result = await runLearningSession();
  if (result.started) {
    console.log(`[learning] ${result.session?.topic}: ${result.reason}`);
  }
}

async function leisureTick(): Promise<void> {
  const settings = getSettings();
  if (!settings.leisure.enabled) return;
  const eligibility = canChooseLeisure(false);
  if (!eligibility.allowed) return;
  if (Math.random() > 0.45) return;
  const result = await runLeisure();
  if (result.started) {
    console.log(`[leisure] ${result.session?.kind}: ${result.session?.activity}`);
  }
}

async function screenTick(): Promise<void> {
  const result = await runScreenPeek(false);
  if (result.ok) {
    console.log(`[screen] peeked: ${result.reason}`);
    if (result.observation && result.observation.interest >= 0.35) {
      await proactiveTick();
    }
  }
}

async function maintenanceTick(): Promise<void> {
  const settings = getSettings();
  const tz = settings.user.timezone;
  const now = nowMs();
  const p = partsInZone(now, tz);
  const today = dateKey(now, tz);

  decayIdleInterests();
  expireStaleProactive(24);
  expireStaleEvents(7 * 24);

  if (p.hour >= 22 || p.hour < 2) {
    const target = p.hour < 2 ? addDays(today, -1) : today;
    if (!getDiary(target)) {
      await generateDiary(target);
      console.log(`[diary] wrote ${target}`);
    }
  }

  if (p.hour >= 2 && p.hour < 5) {
    const state = getState();
    if (state.currentActivity.includes('睡')) {
      await generateDream();
    }
  }

  if (settings.memory.enabled) {
    maybeSummarize('conv-main');
    if (settings.memory.embedding.enabled) {
      const stats = await indexPending(16);
      if (stats.pending > 0 && stats.lastError) {
        console.warn(`[embedding] ${stats.pending} memories pending: ${stats.lastError}`);
      }
    }
    if (getMeta('last_decay') !== today) {
      const archived = decayMemories();
      setMeta('last_decay', today);
      if (archived) console.log(`[memory] archived ${archived} faded memories`);
    }
  }
}

export function startScheduler(): void {
  if (started) return;
  started = true;

  void guard('boot', async () => {
    const settings = getSettings();
    await refreshWeatherCache();
    ensureSchedule(dateKey(nowMs(), settings.user.timezone));
    await tickLife();
    if (settings.memory.embedding.enabled) {
      void indexPending(24);
    }
  });

  timers.push(
    setInterval(() => {
      void guard('tick', async () => {
        await tickLife();
      });
    }, 30_000)
  );

  timers.push(
    setInterval(() => {
      void guard('weather', async () => {
        await refreshWeatherCache();
      });
    }, 30 * 60_000)
  );

  timers.push(
    setInterval(() => {
      void guard('proactive', proactiveTick);
    }, 5 * 60_000)
  );

  timers.push(
    setInterval(() => {
      void guard('learning', learningTick);
    }, 10 * 60_000)
  );

  timers.push(
    setInterval(() => {
      void guard('leisure', leisureTick);
    }, 10 * 60_000)
  );

  timers.push(
    setInterval(() => {
      void guard('screen', screenTick);
    }, 10 * 60_000)
  );

  timers.push(
    setInterval(() => {
      void guard('maintenance', maintenanceTick);
    }, 15 * 60_000)
  );

  timers.push(
    setInterval(() => {
      void guard('weekly-review', weeklyReviewTick);
    }, 10 * 60_000)
  );

  // First proactive check a little after boot, once state has settled.
  timers.push(
    setTimeout(() => {
      void guard('proactive-boot', proactiveTick);
    }, 90_000)
  );

  // First maintenance check after boot, so a late-night start can write a diary.
  timers.push(
    setTimeout(() => {
      void guard('maintenance-boot', maintenanceTick);
    }, 20_000)
  );

  timers.push(
    setTimeout(() => {
      void guard('learning-boot', learningTick);
    }, 3 * 60_000)
  );

  timers.push(
    setTimeout(() => {
      void guard('leisure-boot', leisureTick);
    }, 5 * 60_000)
  );

  timers.push(
    setTimeout(() => {
      void guard('screen-boot', screenTick);
    }, 4 * 60_000)
  );

  timers.push(
    setTimeout(() => {
      void guard('live-boot', resumeLiveAssistant);
    }, 8_000)
  );
}

export function stopScheduler(): void {
  stopped = true;
  for (const timer of timers) {
    clearInterval(timer);
    clearTimeout(timer);
  }
  timers.length = 0;
}
