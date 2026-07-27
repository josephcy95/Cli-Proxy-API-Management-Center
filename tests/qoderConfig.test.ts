import { describe, expect, test } from 'bun:test';
import { normalizeQoderConfigResponse } from '@/services/api/config';

describe('normalizeQoderConfigResponse', () => {
  test('uses the policy defaults for an empty response', () => {
    expect(normalizeQoderConfigResponse({})).toEqual({
      autoDisableInactiveToken: true,
      queuedForbiddenCooldownMinutes: 5,
    });
  });

  test('preserves an explicit disabled auto-disable setting and zero cooldown', () => {
    expect(
      normalizeQoderConfigResponse({
        'auto-disable-inactive-token': false,
        'queued-403-cooldown-minutes': 0,
      })
    ).toEqual({
      autoDisableInactiveToken: false,
      queuedForbiddenCooldownMinutes: 0,
    });
  });

  test('clamps negative and fractional cooldown values', () => {
    expect(normalizeQoderConfigResponse({ 'queued-403-cooldown-minutes': -1.8 })).toEqual({
      autoDisableInactiveToken: true,
      queuedForbiddenCooldownMinutes: 0,
    });
  });
});
