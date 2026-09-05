import { expect, test } from 'bun:test';
import { localDateTime, monitoringBounds, parseLocalDateTime } from '../src/pages/monitoringRange';

test('presets roll but custom bounds remain exact and fixed', () => {
  const now = Date.UTC(2026, 8, 5, 12);
  for (const [preset, days] of [
    ['24h', 1],
    ['7d', 7],
    ['14d', 14],
    ['30d', 30],
  ] as const) {
    expect(monitoringBounds({ preset }, now)).toEqual({
      from_ms: now - days * 86400000,
      to_ms: now,
    });
  }
  expect(monitoringBounds({ preset: 'all' }, now)).toEqual({});
  const custom = { preset: 'custom' as const, from_ms: now - 1234000, to_ms: now };
  expect(monitoringBounds(custom, now + 100000)).toEqual({ from_ms: custom.from_ms, to_ms: now });
});

test('local inputs round trip and invalid or nonexistent local dates are rejected', () => {
  const ms = new Date(2026, 8, 5, 12, 34, 56).getTime();
  expect(parseLocalDateTime(localDateTime(ms))).toBe(ms);
  expect(parseLocalDateTime('2026-09-05T12:34')).toBe(new Date(2026, 8, 5, 12, 34).getTime());
  for (const value of ['', 'bad', '2026-02-30T12:00', '2026-09-05T25:00', '2026-09-05T12:00Z'])
    expect(parseLocalDateTime(value)).toBeNull();
  // Test a DST gap in an isolated process so timezone changes cannot affect other tests.
  const result = Bun.spawnSync(
    [
      process.execPath,
      '-e',
      `
    import { parseLocalDateTime } from './src/pages/monitoringRange.ts';
    if (parseLocalDateTime('2026-03-08T02:30') !== null) process.exit(1);
    if (parseLocalDateTime('2026-03-08T03:30') === null) process.exit(2);
  `,
    ],
    { env: { ...process.env, TZ: 'America/New_York' } }
  );
  expect(result.exitCode).toBe(0);
});
