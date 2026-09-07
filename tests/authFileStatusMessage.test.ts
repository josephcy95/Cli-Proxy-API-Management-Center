import { describe, expect, test } from 'bun:test';
import {
  formatCodexUsageLimitResetDuration,
  isCodexServerOverloadedMessage,
} from '@/features/authFiles/constants';

describe('Codex usage-limit status message', () => {
  const now = Date.parse('2026-09-01T00:00:00Z');

  test('formats resets_at using at most two useful units', () => {
    const resetsAt = Math.floor((now + ((3 * 24 + 11) * 60 + 42) * 60_000) / 1000);
    const message = JSON.stringify({
      error: { type: 'usage_limit_reached', resets_at: resetsAt },
    });

    expect(formatCodexUsageLimitResetDuration(message, now)).toBe('3d 11h');
  });

  test('formats resets_in_seconds as hours and minutes', () => {
    const message = JSON.stringify({
      error: { type: 'usage_limit_reached', resets_in_seconds: 3 * 3600 + 11 * 60 },
    });

    expect(formatCodexUsageLimitResetDuration(message, now)).toBe('3h 11m');
  });

  test('leaves every other error unchanged', () => {
    expect(
      formatCodexUsageLimitResetDuration(
        JSON.stringify({ error: { type: 'invalid_token', resets_in_seconds: 300 } }),
        now
      )
    ).toBeNull();
    expect(formatCodexUsageLimitResetDuration('plain error text', now)).toBeNull();
  });
});

describe('Codex server-overloaded status message', () => {
  const knownError = {
    type: 'service_unavailable_error',
    code: 'server_is_overloaded',
    message: 'Our servers are currently overloaded. Please try again later.',
    param: null,
  };

  test('recognizes the known nested Codex overloaded payload', () => {
    expect(isCodexServerOverloadedMessage(JSON.stringify({ error: knownError }))).toBe(true);
  });

  test('recognizes a root-level overloaded payload', () => {
    expect(isCodexServerOverloadedMessage(JSON.stringify(knownError))).toBe(true);
  });

  test('ignores other service-unavailable errors and plain text', () => {
    expect(
      isCodexServerOverloadedMessage(
        JSON.stringify({ error: { type: 'service_unavailable_error', code: 'other' } })
      )
    ).toBe(false);
    expect(isCodexServerOverloadedMessage('Our servers are currently overloaded.')).toBe(false);
  });
});
