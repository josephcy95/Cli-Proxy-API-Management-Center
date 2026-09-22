import { describe, expect, test } from 'bun:test';
import type { XaiBillingConfig } from '@/types';
import { buildXaiBillingSummary, mergeXaiBillingSummaries } from '@/utils/quota';

const WEEKLY_PERIOD_START = '2026-09-17T13:32:42.093205+00:00';
const WEEKLY_PERIOD_END = '2026-09-24T13:32:42.093205+00:00';

const weeklyConfig = (extra: XaiBillingConfig = {}): XaiBillingConfig => ({
  currentPeriod: {
    type: 'USAGE_PERIOD_TYPE_WEEKLY',
    start: WEEKLY_PERIOD_START,
    end: WEEKLY_PERIOD_END,
  },
  billingPeriodStart: WEEKLY_PERIOD_START,
  billingPeriodEnd: WEEKLY_PERIOD_END,
  onDemandCap: { val: 0 },
  ...extra,
});

const monthlyConfig = (extra: XaiBillingConfig = {}): XaiBillingConfig => ({
  monthlyLimit: { val: 0 },
  used: { val: 0 },
  onDemandCap: { val: 0 },
  billingPeriodStart: '2026-09-01T00:00:00+00:00',
  billingPeriodEnd: '2026-10-01T00:00:00+00:00',
  ...extra,
});

const merged = (weekly: XaiBillingConfig | null, monthly: XaiBillingConfig | null) =>
  mergeXaiBillingSummaries(buildXaiBillingSummary(weekly), buildXaiBillingSummary(monthly));

describe('xAI billing period usage', () => {
  test('keeps weekly usage null when the weekly endpoint omits a percentage', () => {
    const billing = merged(weeklyConfig(), monthlyConfig());
    expect(billing?.periodType).toBe('weekly');
    expect(billing?.usagePercent).toBeNull();
  });

  test.each([0, 3000])('does not use monthly spending %i as weekly usage', (used) => {
    const billing = merged(
      weeklyConfig(),
      monthlyConfig({ monthlyLimit: { val: 15000 }, used: { val: used } })
    );
    expect(billing?.periodType).toBe('weekly');
    expect(billing?.usagePercent).toBeNull();
    expect(billing?.usedPercent).toBe((used / 15000) * 100);
    expect(billing?.periodEnd).toBe(WEEKLY_PERIOD_END);
  });

  test.each([0, 37])('preserves explicit weekly usage %i with monthly spending', (percent) => {
    const billing = merged(
      weeklyConfig({ creditUsagePercent: percent }),
      monthlyConfig({ monthlyLimit: { val: 15000 }, used: { val: 3000 } })
    );
    expect(billing?.usagePercent).toBe(percent);
    expect(billing?.usedPercent).toBe(20);
  });

  test('preserves monthly-only usage', () => {
    const billing = merged(
      null,
      monthlyConfig({ monthlyLimit: { val: 15000 }, used: { val: 3000 } })
    );
    expect(billing?.periodType).toBe('monthly');
    expect(billing?.usagePercent).toBe(20);
  });
});
