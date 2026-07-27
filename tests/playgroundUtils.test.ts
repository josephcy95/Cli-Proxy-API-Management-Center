import { describe, expect, test } from 'bun:test';
import {
  buildPlaygroundProviderGroups,
  normalizePlaygroundProviderBaseUrl,
  pickPlaygroundCredential,
  playgroundCredentialValue,
} from '../src/pages/playgroundUtils';

const candidate = (overrides: Record<string, unknown> = {}) => ({
  provider: 'claude',
  priority: 0,
  auth_index: 'index-1',
  auth_id: 'auth-1',
  status: 'active',
  ...overrides,
});

describe('playground routing options', () => {
  test('groups built-in API keys by provider and normalized base URL', () => {
    const groups = buildPlaygroundProviderGroups([
      candidate({
        auth_index: 'index-1',
        auth_id: 'auth-1',
        base_url: 'HTTPS://API.Example.com/v1/',
      }),
      candidate({
        auth_index: 'index-2',
        auth_id: 'auth-2',
        base_url: 'https://api.example.com/v1',
      }),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.credentials).toHaveLength(2);
  });

  test('keeps case-sensitive base URL paths as separate providers', () => {
    expect(normalizePlaygroundProviderBaseUrl('https://api.example.com/V1')).toBe(
      'https://api.example.com/V1'
    );
    const groups = buildPlaygroundProviderGroups([
      candidate({
        auth_index: 'index-1',
        auth_id: 'auth-1',
        base_url: 'https://api.example.com/v1',
      }),
      candidate({
        auth_index: 'index-2',
        auth_id: 'auth-2',
        base_url: 'https://api.example.com/V1',
      }),
    ]);

    expect(groups).toHaveLength(2);
  });

  test('builds a unique selector value from auth id and index', () => {
    expect(
      playgroundCredentialValue(candidate({ auth_index: 'shared-index', auth_id: 'specific-auth' }))
    ).toBe('specific-auth::shared-index');
  });

  test('selects the first ready credential instead of an unavailable candidate', () => {
    const selected = pickPlaygroundCredential([
      candidate({ auth_index: 'blocked', auth_id: 'blocked', unavailable: true }),
      candidate({ auth_index: 'ready', auth_id: 'ready' }),
    ]);

    expect(selected?.auth_id).toBe('ready');
  });
});
