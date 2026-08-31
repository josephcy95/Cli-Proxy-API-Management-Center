import { describe, expect, test } from 'bun:test';
import {
  buildCodexQuotaFieldsPatch,
  codexQuotaPersistInputFromData,
  resolveCodexResetCredits,
} from '@/utils/quota';

describe('Codex quota snapshot persistence', () => {
  test('overwrites stored reset credits with the latest upstream snapshot, including zero', () => {
    const patch = buildCodexQuotaFieldsPatch(
      {
        planType: 'plus',
        subscriptionActiveUntil: '2026-09-12T08:00:00Z',
        rateLimitResetCreditsAvailableCount: 0,
        rateLimitResetCreditsApplicableAvailableCount: 0,
        rateLimitResetCredits: [],
        resetCreditsFetched: true,
      },
      '2026-08-29T12:00:00.000Z'
    );

    expect(patch).toMatchObject({
      plan_type: 'plus',
      chatgpt_plan_type: 'plus',
      plan_checked_at: '2026-08-29T12:00:00.000Z',
      chatgpt_subscription_active_until: '2026-09-12T08:00:00Z',
      rate_limit_reset_credits_available_count: 0,
      rate_limit_reset_credits_applicable_available_count: 0,
      rate_limit_reset_credits: [],
      rate_limit_reset_credits_checked_at: '2026-08-29T12:00:00.000Z',
    });
  });

  test('keeps previously stored credit expiries when the details request was not fetched', () => {
    const patch = buildCodexQuotaFieldsPatch({
      planType: 'plus',
      rateLimitResetCreditsAvailableCount: 1,
      resetCreditsFetched: false,
    });

    expect(patch.rate_limit_reset_credits_available_count).toBe(1);
    expect(patch.rate_limit_reset_credits).toBeUndefined();
  });

  test('clears stored credits when usage reports zero remaining even without details', () => {
    const patch = buildCodexQuotaFieldsPatch({
      rateLimitResetCreditsAvailableCount: 0,
      resetCreditsFetched: false,
    });

    expect(patch.rate_limit_reset_credits_available_count).toBe(0);
    expect(patch.rate_limit_reset_credits).toEqual([]);
  });

  test('serializes credit expiry timestamps for the auth file', () => {
    const patch = buildCodexQuotaFieldsPatch({
      rateLimitResetCreditsAvailableCount: 1,
      rateLimitResetCredits: [
        {
          id: 'credit-1',
          status: 'available',
          grantedAt: '2026-08-01T00:00:00Z',
          expiresAt: '2026-09-01T04:00:00Z',
        },
      ],
      resetCreditsFetched: true,
    });

    expect(patch.rate_limit_reset_credits).toEqual([
      {
        id: 'credit-1',
        status: 'available',
        granted_at: '2026-08-01T00:00:00Z',
        expires_at: '2026-09-01T04:00:00Z',
      },
    ]);
  });

  test('reads persisted reset availability from an auth file after reload', () => {
    const snapshot = resolveCodexResetCredits({
      name: 'codex.json',
      type: 'codex',
      rate_limit_reset_credits_available_count: 2,
      rate_limit_reset_credits_checked_at: '2026-08-29T12:00:00Z',
      rate_limit_reset_credits: [
        {
          id: 'credit-1',
          status: 'available',
          granted_at: '2026-08-01T00:00:00Z',
          expires_at: '2026-09-01T04:00:00Z',
        },
      ],
    });

    expect(snapshot.availableCount).toBe(2);
    expect(snapshot.checkedAt).toBe('2026-08-29T12:00:00Z');
    expect(snapshot.credits[0]?.expiresAt).toBe('2026-09-01T04:00:00Z');
  });

  test('recovers available reset credits when the stored count is stale', () => {
    const snapshot = resolveCodexResetCredits({
      name: 'codex.json',
      type: 'codex',
      rate_limit_reset_credits_available_count: 0,
      rate_limit_reset_credits: [
        { status: 'available', expires_at: '2026-09-20T22:51:30Z' },
      ],
    });

    expect(snapshot.availableCount).toBe(1);
  });

  test('maps a live quota payload into a persistable snapshot', () => {
    const input = codexQuotaPersistInputFromData({
      planType: 'plus',
      subscriptionActiveUntil: '2026-09-12T08:00:00Z',
      rateLimitResetCreditsAvailableCount: 1,
      rateLimitResetCreditsApplicableAvailableCount: 1,
      rateLimitResetCredits: [
        {
          id: 'credit-1',
          status: 'available',
          grantedAt: '2026-08-01T00:00:00Z',
          expiresAt: '2026-09-01T04:00:00Z',
        },
      ],
      rateLimitResetCreditsError: '',
    });

    expect(input.resetCreditsFetched).toBe(true);
    expect(input.rateLimitResetCreditsAvailableCount).toBe(1);
    expect(input.rateLimitResetCredits?.[0]?.expiresAt).toBe('2026-09-01T04:00:00Z');
  });

  test('does not treat a details-request error as a confirmed empty credit list', () => {
    const input = codexQuotaPersistInputFromData({
      planType: 'plus',
      rateLimitResetCreditsAvailableCount: 1,
      rateLimitResetCredits: [],
      rateLimitResetCreditsError: 'timeout',
    });

    expect(input.resetCreditsFetched).toBe(false);
    const patch = buildCodexQuotaFieldsPatch(input);
    expect(patch.rate_limit_reset_credits_available_count).toBe(1);
    expect(patch.rate_limit_reset_credits).toBeUndefined();
  });
});
