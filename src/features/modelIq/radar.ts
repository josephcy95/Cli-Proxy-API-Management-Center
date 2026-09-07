import { apiCallApi } from '@/services/api/apiCall';

// These are the Codex families in the reference chart, not the API's all-provider leaderboard.
export const MODEL_FAMILIES = [
  { id: 'gpt-6-astra', label: 'Astra', color: '#e98125' },
  { id: 'gpt-5.6-sol', label: 'Sol', color: '#dab629' },
  { id: 'gpt-5.6-terra', label: 'Terra', color: '#7b9fff' },
  { id: 'gpt-5.6-luna', label: 'Luna', color: '#aebbd0' },
  { id: 'gpt-5.5', label: '5.5', color: '#56c7e8' },
] as const;
export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'] as const;
export type RadarMode = 'composite' | 'software' | 'visual';
export type RadarMetric = 'cost' | 'price' | 'minutes';
export interface RadarPoint {
  model: string;
  effort: string;
  iq: number;
  price: number | null;
  minutes: number | null;
  samples: number;
  cost: number | null;
  softwareIq?: number;
  visualIq?: number;
}
export interface RadarSnapshot { updatedAt: string | null; points: RadarPoint[] }
export interface RadarRecommendation { key: string; title: string; items: Array<{ model: string; effort: string; iq: number; average_cost_usd?: number; average_duration_minutes?: number; samples?: number }> }
export interface RadarData { software: RadarSnapshot; visual: RadarSnapshot; recommendations: RadarRecommendation[] }
const numeric = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null;

export function parseRadarSnapshot(value: unknown, source: 'software' | 'visual'): RadarSnapshot {
  if (!value || typeof value !== 'object' || !('points' in value) || !Array.isArray(value.points)) {
    throw new Error('Invalid radar payload');
  }
  const points: RadarPoint[] = [];
  const seen = new Set<string>();
  for (const item of value.points) {
    if (!item || typeof item !== 'object') continue;
    const p = item as Record<string, unknown>;
    if (!MODEL_FAMILIES.some(f => f.id === p.model) ||
        !EFFORTS.some(e => e === p.effort)) continue;
    const iq = numeric(p.iq);
    const samples = numeric(source === 'software' ? p.total ?? p.weighted_total : p.valid_tasks);
    const key = `${p.model}|${p.effort}`;
    if (iq === null || samples === null || samples <= 0 || seen.has(key)) continue;
    seen.add(key);
    points.push({ model: String(p.model), effort: String(p.effort), iq, samples,
      price: numeric(p.average_price_usd), minutes: numeric(p.average_minutes), cost: null });
  }
  if (!points.length) throw new Error('No Codex radar points');
  const at = 'source_updated_at' in value ? value.source_updated_at : null;
  return { points, updatedAt: typeof at === 'string' && Number.isFinite(Date.parse(at)) ? at : null };
}

// Same weighting as Codex Radar's composite chart: each ability's valid task count.
export function combineRadarPoints(software: RadarPoint[], visual: RadarPoint[]): RadarPoint[] {
  const visualByKey = new Map(visual.map(p => [`${p.model}|${p.effort}`, p]));
  return software.flatMap(s => {
    const v = visualByKey.get(`${s.model}|${s.effort}`);
    if (!v) return [];
    const samples = s.samples + v.samples;
    const weighted = (a: number | null, b: number | null) =>
      a === null || b === null ? null : (a * s.samples + b * v.samples) / samples;
    return [{ ...s, iq: weighted(s.iq, v.iq)!, price: weighted(s.price, v.price),
      minutes: weighted(s.minutes, v.minutes), samples, softwareIq: s.iq, visualIq: v.iq }];
  });
}

export function normalizeRadarCost(points: RadarPoint[]): RadarPoint[] {
  // Source formula: price × (minutes / 10)^(log(2.5) / log(1.35)), normalized to 100.
  const exponent = Math.log(2.5) / Math.log(1.35);
  const raw = points.map(p => p.price !== null && p.price > 0 && p.minutes !== null && p.minutes > 0
    ? p.price * Math.pow(p.minutes / 10, exponent) : null);
  const maximum = Math.max(0, ...raw.map(v => v ?? 0));
  return points.map((p, i) => ({ ...p, cost: raw[i] !== null && maximum > 0 ? raw[i]! / maximum * 100 : null }));
}

export function radarMetricValue(p: RadarPoint, metric: RadarMetric): number | null {
  return p[metric];
}

export function createRadarScale(values: number[]) {
  const sorted = [...new Set(values.filter(v => Number.isFinite(v) && v > 0))].sort((a, b) => a - b);
  const min = sorted[0] ?? 1;
  const max = sorted[sorted.length - 1] ?? min;
  const second = sorted[1];
  const broken = second !== undefined && second / min >= 4;
  const share = (v: number, lo: number, hi: number) => hi === lo ? 0.5 : Math.log(v / lo) / Math.log(hi / lo);
  return { min, max, broken,
    position: (v: number) => broken ? (v < second ? 0 : 0.14 + 0.86 * share(v, second, max)) : share(v, min, max),
    ticks: [...(broken ? [min] : []), ...Array.from({ length: 6 }, (_, i) => {
      const lo = broken ? second : min;
      return lo * Math.pow(max / lo, i / 5);
    })].filter((v, i, all) => all.indexOf(v) === i),
  };
}

async function loadInsights(signal: AbortSignal, refresh: boolean): Promise<RadarRecommendation[]> {
  const suffix = refresh ? '?refresh=1' : '';
  let body: unknown;
  if (import.meta.env.DEV) {
    const response = await fetch(`/__dev/codex-radar/radar-insights${suffix}`, { signal, credentials: 'omit' });
    if (!response.ok) throw new Error(`Radar HTTP ${response.status}`);
    body = await response.json();
  } else {
    const result = await apiCallApi.request({ method: 'GET', url: `https://codexradar.com/api/radar-insights${suffix}`, header: { Accept: 'application/json' } }, { signal });
    if (result.statusCode < 200 || result.statusCode >= 300) throw new Error(`Radar HTTP ${result.statusCode}`);
    body = result.body;
  }
  if (!body || typeof body !== 'object' || !('recommendations' in body) || !Array.isArray(body.recommendations)) throw new Error('Invalid insights payload');
  return body.recommendations as RadarRecommendation[];
}

async function loadSource(source: 'software' | 'visual', signal: AbortSignal, refresh: boolean) {
  const path = source === 'software' ? 'intelligence-efficiency-metrics' : 'visual-spatial-reasoning';
  const suffix = refresh ? '?refresh=1' : '';
  let body: unknown;
  if (import.meta.env.DEV) {
    const response = await fetch(`/__dev/codex-radar/${path}${suffix}`, { signal, credentials: 'omit' });
    if (!response.ok) throw new Error(`Radar HTTP ${response.status}`);
    body = await response.json();
  } else {
    const result = await apiCallApi.request({ method: 'GET',
      url: `https://codexradar.com/api/${path}${suffix}`, header: { Accept: 'application/json' } },
    { signal });
    if (result.statusCode < 200 || result.statusCode >= 300) throw new Error(`Radar HTTP ${result.statusCode}`);
    body = result.body;
  }
  return parseRadarSnapshot(body, source);
}
export async function loadRadarData(signal: AbortSignal, refresh = false): Promise<RadarData> {
  const [software, visual, recommendations] = await Promise.all([
    loadSource('software', signal, refresh), loadSource('visual', signal, refresh), loadInsights(signal, refresh),
  ]);
  return { software, visual, recommendations };
}
