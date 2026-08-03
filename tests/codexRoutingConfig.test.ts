import { describe, expect, test } from 'bun:test';
import { normalizeCodexRoutingConfigResponse } from '@/services/api/config';

describe('normalizeCodexRoutingConfigResponse', () => {
  test('defaults Free-first routing to disabled', () => {
    expect(normalizeCodexRoutingConfigResponse({})).toEqual({
      preferFreeForSharedModels: false,
    });
  });

  test('accepts kebab-case and camel-case responses', () => {
    expect(normalizeCodexRoutingConfigResponse({ 'prefer-free-for-shared-models': true })).toEqual({
      preferFreeForSharedModels: true,
    });
    expect(normalizeCodexRoutingConfigResponse({ preferFreeForSharedModels: true })).toEqual({
      preferFreeForSharedModels: true,
    });
  });
});
