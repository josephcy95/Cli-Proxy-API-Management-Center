export type PresetRange = '24h' | '7d' | '14d' | '30d' | 'all';
export type MonitoringRange =
  { preset: PresetRange } | { preset: 'custom'; from_ms: number; to_ms: number };

export function monitoringBounds(range: MonitoringRange, now = Date.now()) {
  if (range.preset === 'custom') return { from_ms: range.from_ms, to_ms: range.to_ms };
  if (range.preset === 'all') return {};
  const days = range.preset === '24h' ? 1 : Number.parseInt(range.preset, 10);
  return { from_ms: now - days * 86_400_000, to_ms: now };
}

export function localDateTime(ms: number): string {
  const date = new Date(ms);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

// Round-trip validation rejects impossible dates and times skipped by DST.
export function parseLocalDateTime(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(value)) return null;
  const normalized = value.length === 16 ? `${value}:00` : value;
  const ms = new Date(normalized).getTime();
  return Number.isFinite(ms) && ms > 0 && localDateTime(ms) === normalized ? ms : null;
}
