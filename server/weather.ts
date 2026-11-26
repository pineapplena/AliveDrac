import type { Weather } from '../shared/types.js';
import { getSettings } from './settings.js';

const WMO: Record<number, string> = {
  0: '晴',
  1: '大致晴朗',
  2: '多云',
  3: '阴',
  45: '有雾',
  48: '雾凇',
  51: '小毛毛雨',
  53: '毛毛雨',
  55: '大毛毛雨',
  56: '冻毛毛雨',
  57: '强冻毛毛雨',
  61: '小雨',
  63: '中雨',
  65: '大雨',
  66: '冻雨',
  67: '强冻雨',
  71: '小雪',
  73: '中雪',
  75: '大雪',
  77: '雪粒',
  80: '阵雨',
  81: '较强阵雨',
  82: '强阵雨',
  85: '小阵雪',
  86: '大阵雪',
  95: '雷雨',
  96: '雷雨伴冰雹',
  99: '强雷雨伴冰雹'
};

let cached: Weather | null = null;
let cachedAt = 0;

function fallbackWeather(): Weather {
  const month = new Date().getMonth() + 1;
  const seasonal =
    month <= 2 ? 7 : month <= 5 ? 18 : month <= 8 ? 29 : month <= 11 ? 20 : 11;
  const label = month >= 6 && month <= 9 ? '多云' : month <= 2 ? '晴冷' : '晴间多云';
  const isDay = new Date().getHours() >= 6 && new Date().getHours() < 18;
  return {
    city: getSettings().life.city,
    temperature: seasonal,
    apparent: seasonal - 1,
    code: 2,
    label,
    wind: 8,
    humidity: 62,
    isDay,
    updatedAt: Date.now(),
    source: 'fallback'
  };
}

export async function getWeather(force = false): Promise<Weather> {
  const settings = getSettings();
  if (!settings.life.weatherEnabled) return fallbackWeather();
  if (!force && cached && Date.now() - cachedAt < 30 * 60_000) {
    return { ...cached, source: 'cache' };
  }
  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.searchParams.set('latitude', String(settings.life.latitude));
  url.searchParams.set('longitude', String(settings.life.longitude));
  url.searchParams.set(
    'current',
    'temperature_2m,apparent_temperature,weather_code,wind_speed_10m,relative_humidity_2m,is_day'
  );
  url.searchParams.set('timezone', settings.user.timezone);

  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(7000) });
    if (!response.ok) throw new Error(`weather ${response.status}`);
    const data = (await response.json()) as any;
    const current = data?.current;
    if (!current) throw new Error('weather empty');
    const code = Number(current.weather_code ?? 2);
    const weather: Weather = {
      city: settings.life.city,
      temperature: Number(current.temperature_2m ?? 20),
      apparent: Number(current.apparent_temperature ?? current.temperature_2m ?? 20),
      code,
      label: WMO[code] ?? '多云',
      wind: Number(current.wind_speed_10m ?? 0),
      humidity: Number(current.relative_humidity_2m ?? 60),
      isDay: Boolean(current.is_day),
      updatedAt: Date.now(),
      source: 'open-meteo'
    };
    cached = weather;
    cachedAt = Date.now();
    return weather;
  } catch {
    const weather = fallbackWeather();
    cached = weather;
    cachedAt = Date.now();
    return weather;
  }
}

export function getCachedWeather(): Weather | null {
  return cached;
}

export function weatherLine(weather: Weather): string {
  return `${weather.label}，${Math.round(weather.temperature)}°C`;
}

export async function geocodeCity(name: string): Promise<
  { name: string; latitude: number; longitude: number; country?: string } | null
> {
  const url = new URL('https://geocoding-api.open-meteo.com/v1/search');
  url.searchParams.set('name', name);
  url.searchParams.set('count', '1');
  url.searchParams.set('language', 'zh');
  url.searchParams.set('format', 'json');
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(7000) });
    if (!response.ok) return null;
    const data = (await response.json()) as any;
    const item = data?.results?.[0];
    if (!item) return null;
    return {
      name: String(item.name),
      latitude: Number(item.latitude),
      longitude: Number(item.longitude),
      country: item.country ? String(item.country) : undefined
    };
  } catch {
    return null;
  }
}
