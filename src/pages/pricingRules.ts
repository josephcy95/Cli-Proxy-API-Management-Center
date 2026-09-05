import type {
  ModelPrice,
  ModelPriceContextTier,
  ModelPriceServiceTier,
  PriceRuleRates,
  PriceSyncCandidate,
  PriceSyncCandidateSet,
} from '@/services/api/usageEvents';

export const candidateIdentity = (candidate: PriceSyncCandidate) =>
  JSON.stringify([candidate.price.source || '', candidate.source_model_id]);

export const candidatePrice = (
  set: PriceSyncCandidateSet,
  selected?: string
): ModelPrice | undefined => {
  const candidate = selected
    ? set.candidates.find((item) => candidateIdentity(item) === selected)
    : set.candidates[0];
  return candidate ? { ...candidate.price, model: set.model } : undefined;
};

export const hasPricingRules = (price?: ModelPrice) =>
  Boolean(price?.context_tiers?.length || price?.service_tiers?.length);

export const priceRateFields = [
  ['prompt_per_1m', 'prompt_configured', 'price_prompt'],
  ['completion_per_1m', 'completion_configured', 'price_completion'],
  ['cache_per_1m', 'cache_configured', 'price_cache_legacy'],
  ['cache_read_per_1m', 'cache_read_configured', 'price_cache_read'],
  ['cache_creation_per_1m', 'cache_creation_configured', 'price_cache_write'],
] as const;

type RateField = (typeof priceRateFields)[number][0];
export type RateDraft = Record<RateField, string>;
export type ContextRuleDraft = RateDraft & { threshold_tokens: string };
export type ServiceRuleDraft = RateDraft & { mode: string; service_tier: string };

export function ruleRateDraft(rates: PriceRuleRates = {}): RateDraft {
  return Object.fromEntries(
    priceRateFields.map(([field, flag]) => [
      field,
      rates[flag] === true || (rates[flag] === undefined && rates[field] !== undefined)
        ? String(rates[field] ?? 0)
        : '',
    ])
  ) as RateDraft;
}

export function parseRuleRates(draft: RateDraft): PriceRuleRates {
  const result: PriceRuleRates = {};
  for (const [field, flag] of priceRateFields) {
    const value = draft[field].trim();
    const rate = Number(value);
    if (!Number.isFinite(rate) || rate < 0) throw new Error('price_invalid_rates');
    result[flag] = value !== '';
    if (value !== '') result[field] = rate;
  }
  return result;
}

/** Overlay only configured fields; an omitted numeric field with a true flag means explicit zero. */
export function inheritRuleRates(base: PriceRuleRates, rule: PriceRuleRates): PriceRuleRates {
  const result = { ...base };
  for (const [field, flag] of priceRateFields) {
    if (rule[flag] === true || (rule[flag] === undefined && rule[field] !== undefined)) {
      result[field] = rule[field] ?? 0;
      result[flag] = true;
    }
  }
  return result;
}

export function parsePricingRules(context: ContextRuleDraft[], service: ServiceRuleDraft[]) {
  const configuredRates = (draft: RateDraft) => {
    const rates = parseRuleRates(draft);
    if (!priceRateFields.some(([, flag]) => rates[flag])) throw new Error('price_empty_rule');
    return rates;
  };
  const thresholds = new Set<number>();
  const context_tiers: ModelPriceContextTier[] = context.map((draft) => {
    const threshold = Number(draft.threshold_tokens);
    if (!Number.isSafeInteger(threshold) || threshold <= 0 || thresholds.has(threshold)) {
      throw new Error('price_invalid_threshold');
    }
    thresholds.add(threshold);
    return { ...configuredRates(draft), threshold_tokens: threshold };
  });
  const identities = new Set<string>();
  const service_tiers: ModelPriceServiceTier[] = service.map((draft) => {
    const mode = draft.mode.trim().toLowerCase();
    const service_tier = draft.service_tier.trim().toLowerCase();
    const normalize = (name: string) => (name === 'fast' ? 'priority' : name);
    if (
      !mode ||
      !service_tier ||
      identities.has(normalize(mode)) ||
      identities.has(normalize(service_tier))
    ) {
      throw new Error('price_invalid_service');
    }
    identities.add(normalize(mode));
    identities.add(normalize(service_tier));
    return { ...configuredRates(draft), mode, service_tier };
  });
  return { context_tiers, service_tiers };
}

/** Same fallback rates as EstimateCostParts; configured zero must never trigger a fallback. */
export function effectiveRuleRates(base: PriceRuleRates, rule: PriceRuleRates): PriceRuleRates {
  const rates = inheritRuleRates(base, rule);
  if (!rates.cache_read_configured && !(rates.cache_read_per_1m! > 0)) {
    rates.cache_read_per_1m = rates.cache_per_1m ?? 0;
  }
  if (!rates.cache_creation_configured && !(rates.cache_creation_per_1m! > 0)) {
    rates.cache_creation_per_1m = (rates.prompt_per_1m ?? 0) * 1.25;
  }
  if (!rates.cache_configured && !(rates.cache_per_1m! > 0)) {
    rates.cache_per_1m = rates.cache_read_per_1m ?? 0;
  }
  return rates;
}

/** One write owns the complete model; editing base prices never silently discards rules. */
export function parsePricingEditor(
  price: ModelPrice,
  base: RateDraft,
  context: ContextRuleDraft[],
  service: ServiceRuleDraft[]
): ModelPrice {
  const rates = parseRuleRates(base);
  // Remove old rate values first: unconfigured fields must not retain stale positive numbers.
  const clean = { ...price };
  for (const [field, flag] of priceRateFields) {
    delete clean[field];
    delete clean[flag];
  }
  return {
    ...clean,
    ...rates,
    prompt_per_1m: rates.prompt_per_1m ?? 0,
    completion_per_1m: rates.completion_per_1m ?? 0,
    ...parsePricingRules(context, service),
    source: 'manual',
  };
}

export function safeDraftRates(draft: RateDraft): PriceRuleRates {
  try {
    return parseRuleRates(draft);
  } catch {
    return {};
  }
}

export function emptyRulesReason(price: ModelPrice) {
  if (price.source === 'manual' || price.source === 'override') return 'price_rules_manual_empty';
  return price.synced_at_ms ? 'price_rules_base_only' : 'price_rules_unchecked';
}

export function syncSummary(result: import('@/services/api/usageEvents').PriceSyncResult) {
  return {
    updated: result.imported,
    unchanged: result.unchanged,
    protected:
      result.outcomes?.filter((outcome) => outcome.status === 'protected').length ??
      result.skipped_manual ??
      0,
    matching: new Set([
      ...(result.candidates || []).map((item) => item.model),
      ...(result.unmatched || []),
    ]).size,
  };
}
