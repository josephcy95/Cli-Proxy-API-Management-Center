import { describe, expect, test } from 'bun:test';
import type { UsageEvent } from '../src/services/api/usageEvents';
import {
  buildRecentStatusData,
  calculateOutputTps,
  formatCompactTokens,
  formatTimestampParts,
  getEffectiveServiceTier,
} from '../src/pages/monitoringMetrics';

const event = (overrides: Partial<UsageEvent>): UsageEvent => ({
  id: 1,
  timestamp_ms: 0,
  input_tokens: 100,
  output_tokens: 100,
  reasoning_tokens: 0,
  cached_tokens: 0,
  cache_read_tokens: 0,
  cache_creation_tokens: 0,
  total_tokens: 200,
  failed: false,
  ...overrides,
});

describe('monitoring metrics', () => {
  test('formats compact token counts and strict 24-hour timestamps', () => {
    expect(formatCompactTokens(82085)).toBe('82.1 K');
    expect(formatCompactTokens(80512)).toBe('80.5 K');
    expect(formatCompactTokens(362)).toBe('362');
    expect(formatTimestampParts(new Date(2026, 7, 30, 16, 11, 32).getTime()).time).toBe('16:11:32');
  });

  test('calculates output TPS from total elapsed time', () => {
    expect(calculateOutputTps(100, 2000)).toBe(50);
    expect(calculateOutputTps(0, 2000)).toBeNull();
    expect(calculateOutputTps(100, 0)).toBeNull();
    expect(calculateOutputTps(undefined, 2000)).toBeNull();
  });

  test('uses requested service tier before response tier', () => {
    expect(
      getEffectiveServiceTier(event({ service_tier: 'priority', response_service_tier: 'default' }))
    ).toBe('priority');
    expect(getEffectiveServiceTier(event({ response_service_tier: 'default' }))).toBe('default');
    expect(getEffectiveServiceTier(event({}))).toBeUndefined();
  });

  test('buckets recent outcomes into success, failure, mixed, and idle', () => {
    const now = 1_200_000;
    const data = buildRecentStatusData(
      [
        event({ id: 1, timestamp_ms: now - 1_000, failed: false }),
        event({ id: 2, timestamp_ms: now - 2_000, failed: true }),
        event({ id: 3, timestamp_ms: now - 10 * 60 * 1000 - 1_000, failed: false }),
      ],
      now
    );

    expect(data.blockDetails.at(-1)).toMatchObject({ success: 1, failure: 1 });
    expect(data.blocks.at(-1)).toBe('mixed');
    expect(data.blocks.at(-2)).toBe('success');
    expect(data.totalSuccess).toBe(2);
    expect(data.totalFailure).toBe(1);
  });
});
