import { describe, expect, test } from 'bun:test';
import {
  canResetAuthCooldown,
  getAuthFileAuthIndex,
  listResettableCooldownFiles,
} from '@/features/authFiles/cooldown';
import type { AuthFileItem } from '@/types';

const baseFile = (overrides: Partial<AuthFileItem> = {}): AuthFileItem => ({
  name: 'acct.json',
  type: 'xai',
  auth_index: 'idx-1',
  disabled: false,
  ...overrides,
});

describe('auth file cooldown reset helpers', () => {
  test('reads auth_index from snake or camel case', () => {
    expect(getAuthFileAuthIndex(baseFile({ auth_index: 'a1' }))).toBe('a1');
    expect(getAuthFileAuthIndex(baseFile({ auth_index: undefined, authIndex: 'b2' }))).toBe('b2');
    expect(getAuthFileAuthIndex(baseFile({ auth_index: '  ', authIndex: null }))).toBeNull();
  });

  test('allows xAI cooled-down credentials', () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    expect(
      canResetAuthCooldown(
        baseFile({
          type: 'xai',
          xai_cooldown_until: future,
        })
      )
    ).toBe(true);
  });

  test('allows codex usage-limit cooldown messages', () => {
    expect(
      canResetAuthCooldown(
        baseFile({
          type: 'codex',
          status_message: 'usage_limit_reached',
        })
      )
    ).toBe(true);
  });

  test('rejects permanently disabled or runtime-only files', () => {
    expect(canResetAuthCooldown(baseFile({ disabled: true, xai_cooldown_until: Date.now() + 1 }))).toBe(
      false
    );
    expect(
      canResetAuthCooldown(
        baseFile({
          runtimeOnly: true,
          unavailable: true,
        })
      )
    ).toBe(false);
  });

  test('lists only resettable files from a mixed set', () => {
    const future = new Date(Date.now() + 30_000).toISOString();
    const files = [
      baseFile({ name: 'cool.json', xai_cooldown_until: future }),
      baseFile({ name: 'ok.json', type: 'claude' }),
      baseFile({ name: 'no-index.json', auth_index: '', authIndex: null, unavailable: true }),
    ];
    expect(listResettableCooldownFiles(files).map((f) => f.name)).toEqual(['cool.json']);
  });
});
