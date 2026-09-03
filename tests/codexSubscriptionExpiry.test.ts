import { describe, expect, test } from 'bun:test';
import type { AuthFileItem } from '@/types';
import { resolveCodexSubscriptionActiveUntil } from '@/utils/quota/resolvers';

describe('resolveCodexSubscriptionActiveUntil', () => {
  test('uses the newer JWT billing date instead of OAuth token expiry', () => {
    const file = {
      expired: '2026-09-13T11:06:19+08:00',
      chatgpt_subscription_active_until: '2026-09-13T11:06:19+08:00',
      id_token: {
        'https://api.openai.com/auth': {
          chatgpt_subscription_active_until: '2026-10-02T07:39:13+08:00',
        },
      },
    } as unknown as AuthFileItem;

    expect(resolveCodexSubscriptionActiveUntil(file)).toBe('2026-10-02T07:39:13+08:00');
  });

  test('does not treat generic OAuth expiry as a billing date', () => {
    const file = { expired: '2026-09-13T11:06:19+08:00' } as unknown as AuthFileItem;
    expect(resolveCodexSubscriptionActiveUntil(file)).toBeNull();
  });
});
