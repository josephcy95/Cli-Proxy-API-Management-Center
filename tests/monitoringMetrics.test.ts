import { describe, expect, test } from 'bun:test';
import type { UsageEvent } from '../src/services/api/usageEvents';
import {
  buildRecentStatusData,
  calculateOutputTps,
  formatCompactTokens,
  formatTimestampParts,
  formatVisibleTokenBreakdown,
  getEffectiveServiceTier,
  getTokenDetailLines,
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

  test('keeps the visible usage breakdown to input and output', () => {
    expect(
      formatVisibleTokenBreakdown(
        event({
          input_tokens: 131700,
          output_tokens: 630,
          reasoning_tokens: 153,
          cache_read_tokens: 112900,
        })
      )
    ).toBe('I 131.7 K · O 630');
  });

  test('builds explicit token details without double-counting legacy cached values', () => {
    const labels = {
      total: 'Total',
      input: 'Input',
      output: 'Output',
      reasoning: 'Reasoning',
      cacheRead: 'Cache read',
      cacheCreation: 'Cache write',
      legacyCached: 'Cached (legacy)',
    };
    expect(
      getTokenDetailLines(
        event({
          total_tokens: 132300,
          input_tokens: 131700,
          output_tokens: 630,
          reasoning_tokens: 153,
          cached_tokens: 112900,
          cache_read_tokens: 112900,
          cache_creation_tokens: 250,
        }),
        labels
      )
    ).toEqual([
      { label: 'Total', value: '132.3 K' },
      { label: 'Input', value: '131.7 K' },
      { label: 'Output', value: '630' },
      { label: 'Reasoning', value: '153' },
      { label: 'Cache read', value: '112.9 K' },
      { label: 'Cache write', value: '250' },
    ]);
    expect(getTokenDetailLines(event({ cached_tokens: 80512 }), labels).at(-1)).toEqual({
      label: 'Cached (legacy)',
      value: '80.5 K',
    });
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
