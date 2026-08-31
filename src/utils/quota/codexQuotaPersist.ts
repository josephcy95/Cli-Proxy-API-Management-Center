import { authFilesApi, type AuthFileFieldsPatch } from '@/services/api';
import type { CodexQuotaWindow, CodexRateLimitResetCredit } from '@/types';

export type CodexQuotaPersistInput = {
  planType?: string | null;
  subscriptionActiveUntil?: string | number | null;
  rateLimitResetCreditsAvailableCount?: number | null;
  rateLimitResetCreditsApplicableAvailableCount?: number | null;
  rateLimitResetCredits?: CodexRateLimitResetCredit[] | null;
  windows?: CodexQuotaWindow[] | null;
  /** True when the reset-credits details endpoint was read successfully. */
  resetCreditsFetched?: boolean;
};

const asCredit = (value: unknown): CodexRateLimitResetCredit | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const expiresAt =
    typeof record.expiresAt === 'string'
      ? record.expiresAt
      : typeof record.expires_at === 'string'
        ? record.expires_at
        : '';
  if (!expiresAt) return null;
  return {
    id: typeof record.id === 'string' ? record.id : '',
    status: typeof record.status === 'string' ? record.status : '',
    grantedAt:
      typeof record.grantedAt === 'string'
        ? record.grantedAt
        : typeof record.granted_at === 'string'
          ? record.granted_at
          : '',
    expiresAt,
  };
};

export const codexQuotaPersistInputFromData = (data: unknown): CodexQuotaPersistInput => {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return {};
  const record = data as Record<string, unknown>;
  const credits = Array.isArray(record.rateLimitResetCredits)
    ? record.rateLimitResetCredits
        .map((item) => asCredit(item))
        .filter((item): item is CodexRateLimitResetCredit => Boolean(item))
    : null;
  const availableCount =
    typeof record.rateLimitResetCreditsAvailableCount === 'number' &&
    Number.isFinite(record.rateLimitResetCreditsAvailableCount)
      ? record.rateLimitResetCreditsAvailableCount
      : null;
  const applicableCount =
    typeof record.rateLimitResetCreditsApplicableAvailableCount === 'number' &&
    Number.isFinite(record.rateLimitResetCreditsApplicableAvailableCount)
      ? record.rateLimitResetCreditsApplicableAvailableCount
      : null;
  const windows = Array.isArray(record.windows)
    ? record.windows.filter(
        (window): window is CodexQuotaWindow =>
          Boolean(window) &&
          typeof window === 'object' &&
          typeof (window as Record<string, unknown>).id === 'string'
      )
    : null;
  return {
    planType: typeof record.planType === 'string' ? record.planType : null,
    subscriptionActiveUntil:
      typeof record.subscriptionActiveUntil === 'string' ||
      typeof record.subscriptionActiveUntil === 'number'
        ? record.subscriptionActiveUntil
        : null,
    rateLimitResetCreditsAvailableCount: availableCount,
    rateLimitResetCreditsApplicableAvailableCount: applicableCount,
    rateLimitResetCredits: credits,
    windows,
    resetCreditsFetched:
      typeof record.rateLimitResetCreditsError === 'string'
        ? record.rateLimitResetCreditsError.trim() === ''
        : credits != null,
  };
};

const serializeResetCredit = (credit: CodexRateLimitResetCredit): Record<string, string> => ({
  id: credit.id,
  status: credit.status,
  granted_at: credit.grantedAt,
  expires_at: credit.expiresAt,
});

export const buildCodexQuotaFieldsPatch = (
  input: CodexQuotaPersistInput,
  checkedAt = new Date().toISOString()
): AuthFileFieldsPatch => {
  const patch: AuthFileFieldsPatch = {};
  const planType = input.planType?.trim();
  if (planType) {
    patch.plan_type = planType;
    patch.chatgpt_plan_type = planType;
    patch.plan_checked_at = checkedAt;
  }

  if (input.subscriptionActiveUntil != null && input.subscriptionActiveUntil !== '') {
    patch.chatgpt_subscription_active_until = input.subscriptionActiveUntil;
  }

  const checkedAtMs = Date.parse(checkedAt);
  input.windows?.forEach((window) => {
    const prefix =
      window.id === 'five-hour' ? 'Primary' : window.id === 'weekly' ? 'Secondary' : null;
    if (!prefix || window.usedPercent == null) return;
    patch[`X-Codex-${prefix}-Used-Percent`] = window.usedPercent;
    patch[`X-Codex-${prefix}-Window-Minutes`] = window.id === 'weekly' ? 10080 : 300;
    if (window.resetAt != null && Number.isFinite(window.resetAt)) {
      patch[`X-Codex-${prefix}-Reset-At`] = Math.floor(window.resetAt / 1000);
      if (Number.isFinite(checkedAtMs)) {
        patch[`X-Codex-${prefix}-Reset-After-Seconds`] = Math.max(
          0,
          Math.ceil((window.resetAt - checkedAtMs) / 1000)
        );
      }
    } else {
      patch[`X-Codex-${prefix}-Reset-At`] = null;
      patch[`X-Codex-${prefix}-Reset-After-Seconds`] = null;
    }
  });
  if (input.windows && input.windows.length > 0) {
    patch.codex_quota_observed_at = checkedAt;
  }

  // The usage endpoint is allowed to return only a summary. Keep updating the
  // counts, but only replace the durable credit list after the details endpoint
  // completed successfully.
  const fetchedCredits = input.resetCreditsFetched === true ? (input.rateLimitResetCredits ?? []) : null;
  let availableCount = input.rateLimitResetCreditsAvailableCount ?? null;
  if (availableCount == null && fetchedCredits) {
    availableCount = fetchedCredits.length;
  }

  if (availableCount != null) {
    patch.rate_limit_reset_credits_available_count = availableCount;
    patch.rate_limit_reset_credits_checked_at = checkedAt;
  }
  if (input.rateLimitResetCreditsApplicableAvailableCount != null) {
    patch.rate_limit_reset_credits_applicable_available_count =
      input.rateLimitResetCreditsApplicableAvailableCount;
    patch.rate_limit_reset_credits_checked_at ??= checkedAt;
  }
  if (fetchedCredits) {
    patch.rate_limit_reset_credits = fetchedCredits.map(serializeResetCredit);
    patch.rate_limit_reset_credits_checked_at ??= checkedAt;
  }

  return patch;
};

export const persistCodexQuotaSnapshot = async (
  fileName: string,
  input: CodexQuotaPersistInput,
  checkedAt = new Date().toISOString()
): Promise<boolean> => {
  const patch = buildCodexQuotaFieldsPatch(input, checkedAt);
  if (Object.keys(patch).length === 0) return false;
  await authFilesApi.patchFields(fileName, patch);
  return true;
};
