import { describe, expect, test } from 'bun:test';
import { normalizeCodexRoutingConfigResponse } from '@/services/api/config';

describe('normalizeCodexRoutingConfigResponse', () => {
  test('defaults to inheriting the global strategy', () => {
    expect(normalizeCodexRoutingConfigResponse({})).toEqual({
      strategy: '',
      preferFreeForSharedModels: false,
    });
  });

  test('accepts adaptive and preserves Free-first routing', () => {
    expect(
      normalizeCodexRoutingConfigResponse({
        strategy: 'adaptive',
        'prefer-free-for-shared-models': true,
      })
    ).toEqual({
      strategy: 'adaptive',
      preferFreeForSharedModels: true,
    });
    expect(normalizeCodexRoutingConfigResponse({ preferFreeForSharedModels: true })).toEqual({
      strategy: '',
      preferFreeForSharedModels: true,
    });
  });
});
