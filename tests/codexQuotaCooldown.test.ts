import { describe, expect, test } from 'bun:test';
import { codexQuotaHasAvailableCapacity } from '@/components/quota/quotaConfigs';

describe('Codex quota cooldown recovery', () => {
  test('clears local cooldown when refreshed windows have capacity', () => {
    expect(
      codexQuotaHasAvailableCapacity({
        planType: 'plus',
        subscriptionActiveUntil: null,
        rateLimitResetCreditsAvailableCount: null,
        rateLimitResetCreditsApplicableAvailableCount: null,
        windows: [
          { id: 'five-hour', label: '5h', usedPercent: 40, resetLabel: '-' },
          { id: 'weekly', label: 'week', usedPercent: 100, resetLabel: '-' },
        ],
      })
    ).toBe(false);
    expect(
      codexQuotaHasAvailableCapacity({
        planType: 'plus',
        subscriptionActiveUntil: null,
        rateLimitResetCreditsAvailableCount: null,
        rateLimitResetCreditsApplicableAvailableCount: null,
        windows: [{ id: 'five-hour', label: '5h', usedPercent: 40, resetLabel: '-' }],
      })
    ).toBe(false);
    expect(
      codexQuotaHasAvailableCapacity({
        planType: 'plus',
        subscriptionActiveUntil: null,
        rateLimitResetCreditsAvailableCount: null,
        rateLimitResetCreditsApplicableAvailableCount: null,
        windows: [
          { id: 'five-hour', label: '5h', usedPercent: 40, resetLabel: '-' },
          { id: 'unknown', label: 'unknown', usedPercent: null, resetLabel: '-' },
        ],
      })
    ).toBe(false);
    expect(
      codexQuotaHasAvailableCapacity({
        planType: 'plus',
        subscriptionActiveUntil: null,
        rateLimitResetCreditsAvailableCount: null,
        rateLimitResetCreditsApplicableAvailableCount: null,
        windows: [
          { id: 'five-hour', label: '5h', usedPercent: 40, resetLabel: '-' },
          { id: 'weekly', label: 'week', usedPercent: 75, resetLabel: '-' },
          { id: 'code-review-weekly', label: 'review', usedPercent: 100, resetLabel: '-' },
        ],
      })
    ).toBe(true);
  });
});
