import { describe, expect, test } from 'bun:test';
import {
  candidateIdentity,
  candidatePrice,
  hasPricingRules,
  inheritRuleRates,
  effectiveRuleRates,
  parsePricingRules,
  parseRuleRates,
  ruleRateDraft,
} from '@/pages/pricingRules';
import type { PriceSyncCandidateSet } from '@/services/api/usageEvents';

const set: PriceSyncCandidateSet = {
  model: 'alias-model',
  candidates: [
    {
      source_model_id: 'same-id',
      score: 1,
      reason: 'exact',
      price: {
        model: 'canonical',
        prompt_per_1m: 0,
        completion_per_1m: 2,
        source: 'models.dev',
        source_model_id: 'same-id',
        raw_json: '{"original":true}',
        synced_at_ms: 123,
        context_tiers: [{ threshold_tokens: 1000, prompt_per_1m: 3, prompt_configured: true }],
        service_tiers: [
          {
            mode: 'fast',
            service_tier: 'priority',
            completion_per_1m: 4,
            completion_configured: true,
          },
        ],
      },
    },
    {
      source_model_id: 'same-id',
      score: 0.9,
      reason: 'same id',
      price: { model: 'other', prompt_per_1m: 5, completion_per_1m: 6, source: 'litellm' },
    },
  ],
};

describe('pricing rule integration', () => {
  test('candidate identity includes source and does not collide on delimiters', () => {
    expect(candidateIdentity(set.candidates[0])).not.toBe(candidateIdentity(set.candidates[1]));
    expect(candidatePrice(set, candidateIdentity(set.candidates[1]))?.source).toBe('litellm');
    expect(
      candidateIdentity({
        ...set.candidates[0],
        source_model_id: 'a:b',
        price: { ...set.candidates[0].price, source: 'c' },
      })
    ).not.toBe(
      candidateIdentity({
        ...set.candidates[0],
        source_model_id: 'b',
        price: { ...set.candidates[0].price, source: 'c:a' },
      })
    );
  });

  test('candidate application inherits the entire price including metadata, rules and zeros', () => {
    const price = candidatePrice(set, candidateIdentity(set.candidates[0]));
    expect(price).toEqual({ ...set.candidates[0].price, model: 'alias-model' });
    expect(hasPricingRules(price)).toBe(true);
    expect(set.candidates[0].price.model).toBe('canonical');
    expect(candidatePrice(set, 'stale-selection')).toBeUndefined();
    expect(candidatePrice({ model: 'empty', candidates: [] })).toBeUndefined();
  });

  test('unconfigured rates inherit while explicit zero overrides, even when JSON omits its number', () => {
    const base = { prompt_per_1m: 2, completion_per_1m: 5, cache_read_per_1m: 1 };
    expect(
      inheritRuleRates(base, {
        prompt_configured: false,
        prompt_per_1m: 9,
        cache_read_configured: true,
      })
    ).toEqual({ ...base, cache_read_per_1m: 0, cache_read_configured: true });
    const draft = ruleRateDraft({ cache_read_configured: true, completion_configured: false });
    expect(draft.cache_read_per_1m).toBe('0');
    expect(draft.completion_per_1m).toBe('');
    const parsed = parseRuleRates(draft);
    expect(parsed.cache_read_configured).toBe(true);
    expect(parsed.cache_read_per_1m).toBe(0);
    expect(parsed.completion_configured).toBe(false);
    expect(parsed.completion_per_1m).toBeUndefined();
  });

  test('all five configured flags and values round-trip through rule editing', () => {
    const draft = {
      prompt_per_1m: '0',
      completion_per_1m: '5',
      cache_per_1m: '',
      cache_read_per_1m: '0',
      cache_creation_per_1m: '3',
    };
    const parsed = parsePricingRules(
      [{ ...draft, threshold_tokens: '200000' }],
      [{ ...draft, mode: ' Fast ', service_tier: 'Priority' }]
    );
    expect(ruleRateDraft(parsed.context_tiers[0])).toEqual(draft);
    expect(parsed.service_tiers[0]).toMatchObject({
      mode: 'fast',
      service_tier: 'priority',
      prompt_configured: true,
      cache_configured: false,
    });
    expect(parsePricingRules([], [])).toEqual({ context_tiers: [], service_tiers: [] });
  });

  test('rejects negative/non-finite rates, invalid or duplicate thresholds, ambiguous service names', () => {
    for (const value of ['-1', 'Infinity', 'not-a-rate']) {
      expect(() => parseRuleRates({ ...ruleRateDraft(), prompt_per_1m: value })).toThrow(
        'price_invalid_rates'
      );
    }
    for (const value of ['', '0', '-1', '1.5', '9007199254740992']) {
      expect(() =>
        parsePricingRules([{ ...ruleRateDraft(), threshold_tokens: value }], [])
      ).toThrow('price_invalid_threshold');
    }
    const context = { ...ruleRateDraft(), prompt_per_1m: '0', threshold_tokens: '1000' };
    expect(() => parsePricingRules([context, context], [])).toThrow('price_invalid_threshold');
    const service = {
      ...ruleRateDraft(),
      prompt_per_1m: '0',
      mode: 'fast',
      service_tier: 'priority',
    };
    expect(() =>
      parsePricingRules([], [service, { ...service, mode: 'PRIORITY', service_tier: 'other' }])
    ).toThrow('price_invalid_service');
    expect(() => parsePricingRules([{ ...ruleRateDraft(), threshold_tokens: '1000' }], [])).toThrow(
      'price_empty_rule'
    );
    expect(() =>
      parsePricingRules([], [service, { ...service, mode: 'other', service_tier: 'FAST' }])
    ).toThrow('price_invalid_service');
    expect(() => parsePricingRules([], [{ ...service, mode: '' }])).toThrow(
      'price_invalid_service'
    );
  });
});

test('effective cache rates use backend fallbacks without replacing configured zero', () => {
  expect(effectiveRuleRates({ prompt_per_1m: 2, cache_per_1m: 1 }, {})).toMatchObject({
    cache_read_per_1m: 1,
    cache_creation_per_1m: 2.5,
  });
  expect(
    effectiveRuleRates(
      { prompt_per_1m: 2, cache_per_1m: 1 },
      { cache_read_configured: true, cache_creation_configured: true }
    )
  ).toMatchObject({ cache_read_per_1m: 0, cache_creation_per_1m: 0 });
});
