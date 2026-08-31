/**
 * Resolver functions for extracting data from auth files.
 */

import type { AuthFileItem, CodexRateLimitResetCredit } from '@/types';
import {
  normalizeNumberValue,
  normalizeStringValue,
  normalizePlanType,
  parseIdTokenPayload,
} from './parsers';

const toRecord = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
};

const resolveCodexAuthInfo = (value: unknown): Record<string, unknown> | null => {
  const payload = parseIdTokenPayload(value);
  if (!payload) return null;
  const nested = toRecord(payload['https://api.openai.com/auth']);
  return nested ?? payload;
};

export function extractCodexChatgptAccountId(value: unknown): string | null {
  const payload = parseIdTokenPayload(value);
  if (!payload) return null;
  return normalizeStringValue(payload.chatgpt_account_id ?? payload.chatgptAccountId);
}

export function resolveCodexChatgptAccountId(file: AuthFileItem): string | null {
  const metadata =
    file && typeof file.metadata === 'object' && file.metadata !== null
      ? (file.metadata as Record<string, unknown>)
      : null;
  const attributes =
    file && typeof file.attributes === 'object' && file.attributes !== null
      ? (file.attributes as Record<string, unknown>)
      : null;

  const candidates = [file.id_token, metadata?.id_token, attributes?.id_token];

  for (const candidate of candidates) {
    const id = extractCodexChatgptAccountId(candidate);
    if (id) return id;
  }

  return null;
}

const planTypeFromAuthInfo = (value: unknown): string | null => {
  const authInfo = resolveCodexAuthInfo(value);
  if (!authInfo) return null;
  return (
    normalizePlanType(authInfo.chatgpt_plan_type) ??
    normalizePlanType(authInfo.chatgptPlanType) ??
    normalizePlanType(authInfo.plan_type) ??
    normalizePlanType(authInfo.planType)
  );
};

export function resolveCodexPlanType(file: AuthFileItem): string | null {
  const metadata =
    file && typeof file.metadata === 'object' && file.metadata !== null
      ? (file.metadata as Record<string, unknown>)
      : null;
  const attributes =
    file && typeof file.attributes === 'object' && file.attributes !== null
      ? (file.attributes as Record<string, unknown>)
      : null;
  const idToken =
    file && typeof file.id_token === 'object' && file.id_token !== null
      ? (file.id_token as Record<string, unknown>)
      : null;
  const metadataIdToken =
    metadata && typeof metadata.id_token === 'object' && metadata.id_token !== null
      ? (metadata.id_token as Record<string, unknown>)
      : null;

  // Prefer explicitly stored plan fields over JWT-derived values so quota
  // refresh can correct stale chatgpt_plan_type claims after downgrades.
  const storedCandidates = [
    file.plan_type,
    file.planType,
    file['plan_type'],
    file['planType'],
    metadata?.plan_type,
    metadata?.planType,
    attributes?.plan_type,
    attributes?.planType,
    file.chatgpt_plan_type,
    file.chatgptPlanType,
    file['chatgpt_plan_type'],
    file['chatgptPlanType'],
    metadata?.chatgpt_plan_type,
    metadata?.chatgptPlanType,
    attributes?.chatgpt_plan_type,
    attributes?.chatgptPlanType,
  ];

  for (const candidate of storedCandidates) {
    const planType = normalizePlanType(candidate);
    if (planType) return planType;
  }

  const tokenCandidates = [
    planTypeFromAuthInfo(file.id_token),
    planTypeFromAuthInfo(idToken),
    planTypeFromAuthInfo(metadata?.id_token),
    planTypeFromAuthInfo(metadataIdToken),
    planTypeFromAuthInfo(attributes?.id_token),
    normalizePlanType(idToken?.plan_type),
    normalizePlanType(idToken?.planType),
    normalizePlanType(metadataIdToken?.plan_type),
    normalizePlanType(metadataIdToken?.planType),
  ];

  for (const planType of tokenCandidates) {
    if (planType) return planType;
  }

  return null;
}

const normalizeDateLikeValue = (value: unknown): string | number | null => {
  const numberValue = normalizeNumberValue(value);
  if (numberValue === 0) return null;
  if (numberValue !== null) return numberValue;

  const stringValue = normalizeStringValue(value);
  if (!stringValue || stringValue === '0') return null;
  return stringValue;
};

export function resolveCodexSubscriptionActiveUntil(file: AuthFileItem): string | number | null {
  const metadata = toRecord(file.metadata);
  const attributes = toRecord(file.attributes);
  const idToken = resolveCodexAuthInfo(file.id_token);
  const metadataIdToken = resolveCodexAuthInfo(metadata?.id_token);
  const attributesIdToken = resolveCodexAuthInfo(attributes?.id_token);
  const subscription = toRecord(file.subscription);
  const metadataSubscription = toRecord(metadata?.subscription);
  const attributesSubscription = toRecord(attributes?.subscription);

  const candidates = [
    file.chatgpt_subscription_active_until,
    file.chatgptSubscriptionActiveUntil,
    file.subscription_active_until,
    file.subscriptionActiveUntil,
    file.expired,
    file.expires_at,
    file.expires,
    subscription?.active_until,
    subscription?.activeUntil,
    idToken?.chatgpt_subscription_active_until,
    idToken?.chatgptSubscriptionActiveUntil,
    metadata?.chatgpt_subscription_active_until,
    metadata?.chatgptSubscriptionActiveUntil,
    metadata?.subscription_active_until,
    metadata?.subscriptionActiveUntil,
    metadata?.expired,
    metadata?.expires_at,
    metadata?.expires,
    metadataSubscription?.active_until,
    metadataSubscription?.activeUntil,
    metadataIdToken?.chatgpt_subscription_active_until,
    metadataIdToken?.chatgptSubscriptionActiveUntil,
    attributes?.chatgpt_subscription_active_until,
    attributes?.chatgptSubscriptionActiveUntil,
    attributes?.subscription_active_until,
    attributes?.subscriptionActiveUntil,
    attributesSubscription?.active_until,
    attributesSubscription?.activeUntil,
    attributesIdToken?.chatgpt_subscription_active_until,
    attributesIdToken?.chatgptSubscriptionActiveUntil,
  ];

  for (const candidate of candidates) {
    const value = normalizeDateLikeValue(candidate);
    if (value !== null) return value;
  }

  return null;
}

export type CodexResetCreditsFileSnapshot = {
  availableCount: number;
  applicableAvailableCount: number | null;
  credits: CodexRateLimitResetCredit[];
  checkedAt: string | null;
};

const normalizeResetCredit = (value: unknown): CodexRateLimitResetCredit | null => {
  const record = toRecord(value);
  if (!record) return null;
  const expiresAt = normalizeStringValue(record.expires_at ?? record.expiresAt);
  if (!expiresAt) return null;
  return {
    id: normalizeStringValue(record.id) ?? '',
    status: normalizeStringValue(record.status) ?? '',
    grantedAt: normalizeStringValue(record.granted_at ?? record.grantedAt) ?? '',
    expiresAt,
  };
};

const readResetCreditsList = (value: unknown): CodexRateLimitResetCredit[] => {
  if (Array.isArray(value)) {
    return value
      .map((item) => normalizeResetCredit(item))
      .filter((item): item is CodexRateLimitResetCredit => Boolean(item));
  }
  const record = toRecord(value);
  if (!record) return [];
  for (const key of ['credits', 'items', 'data']) {
    const nested = readResetCreditsList(record[key]);
    if (nested.length > 0) return nested;
  }
  return [];
};

export function resolveCodexResetCredits(file: AuthFileItem): CodexResetCreditsFileSnapshot {
  const metadata = toRecord(file.metadata);
  const attributes = toRecord(file.attributes);
  const quota = toRecord(file.quota);
  const quotaSignals = toRecord(quota?.signals);
  const sources = [file, metadata, quota, quotaSignals, attributes].filter(
    (source): source is Record<string, unknown> => source != null
  );
  const readValue = (...keys: string[]): unknown => {
    for (const source of sources) {
      if (!source) continue;
      for (const key of keys) {
        if (source[key] != null) return source[key];
      }
    }
    return undefined;
  };

  const resetCreditValues = sources.flatMap((source) => [
    source['rate_limit_reset_credits'],
    source['rateLimitResetCredits'],
  ]);
  const credits = resetCreditValues.flatMap((value) => readResetCreditsList(value));
  const availableCounts = sources.flatMap((source) => [
    normalizeNumberValue(
      source['rate_limit_reset_credits_available_count'] ??
        source['rateLimitResetCreditsAvailableCount']
    ),
    ...resetCreditValues.map((value) => {
      const summary = toRecord(value);
      return normalizeNumberValue(summary?.available_count ?? summary?.availableCount);
    }),
  ]);
  const applicableCounts = sources.flatMap((source) => [
    normalizeNumberValue(
      source['rate_limit_reset_credits_applicable_available_count'] ??
        source['rateLimitResetCreditsApplicableAvailableCount']
    ),
    ...resetCreditValues.map((value) => {
      const summary = toRecord(value);
      return normalizeNumberValue(
        summary?.applicable_available_count ?? summary?.applicableAvailableCount
      );
    }),
  ]);
  const storedAvailableCount = Math.max(0, ...availableCounts.filter((value): value is number => value != null));
  const applicableAvailableCount = applicableCounts.reduce<number | null>(
    (highest, value) =>
      value != null && (highest == null || value > highest) ? value : highest,
    null
  );
  // Prefer explicit availability, but recover from stale zero counts when the
  // persisted credit list or summary still contains available credits.
  const listedAvailableCount = credits.filter(
    (credit) => !credit.status || credit.status.toLowerCase() === 'available'
  ).length;
  const availableCount = Math.max(
    storedAvailableCount,
    applicableAvailableCount ?? 0,
    listedAvailableCount
  );

  const checkedAt = normalizeStringValue(
    readValue('rate_limit_reset_credits_checked_at', 'rateLimitResetCreditsCheckedAt')
  );

  return {
    availableCount,
    applicableAvailableCount,
    credits,
    checkedAt,
  };
}
