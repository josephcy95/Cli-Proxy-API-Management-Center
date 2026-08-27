import { parsePriorityValue } from '@/features/authFiles/constants';
import type { AuthFileItem, CodexQuotaWindow } from '@/types';
import { normalizePlanType, resolveCodexPlanType } from '@/utils/quota';

export const CODEX_PLAN_FILTERS = [
  'all',
  'free',
  'k12',
  'plus',
  'team',
  'prolite',
  'pro',
  'unknown',
] as const;

/** Visible status filters. `other` remains an internal classification for All and sorting. */
export const CODEX_STATUS_FILTERS = ['all', 'available', 'cooldown', 'denied'] as const;

export type CodexPlanFilter = (typeof CODEX_PLAN_FILTERS)[number];
export type CodexStatusFilter = (typeof CODEX_STATUS_FILTERS)[number];
export type CodexAccountStatusKind = 'working' | 'other' | 'cooldown' | 'denied';

export type CodexRefreshState = {
  status: 'idle' | 'loading' | 'success' | 'error';
  planType: string | null;
  windows: CodexQuotaWindow[];
  error?: string;
  errorStatus?: number;
};

export type CodexAccountStatus = {
  kind: CodexAccountStatusKind;
  needsReauth: boolean;
  quotaLimited: boolean;
  fiveHourLimited: boolean;
  weeklyLimited: boolean;
  monthlyLimited: boolean;
};

const CODEX_AVAILABILITY_STATUS_RANK: Record<CodexAccountStatusKind, number> = {
  working: 0,
  other: 1,
  cooldown: 2,
  denied: 3,
};

/** Returns the fixed availability ordering used by the Codex auth-file list. */
export const getCodexAvailabilityStatusRank = (kind: CodexAccountStatusKind): number =>
  CODEX_AVAILABILITY_STATUS_RANK[kind];

const PREMIUM_PLAN_TYPES = new Set(['prolite', 'pro-lite', 'pro_lite']);

const normalizedPlanFilterValue = (value: string | null): CodexPlanFilter | null => {
  const normalized = normalizePlanType(value);
  if (!normalized) return null;
  if (
    normalized === 'free' ||
    normalized === 'k12' ||
    normalized === 'plus' ||
    normalized === 'team' ||
    normalized === 'pro'
  ) {
    return normalized;
  }
  return PREMIUM_PLAN_TYPES.has(normalized) ? 'prolite' : null;
};

export const getCodexPlanFilterValue = (
  file: AuthFileItem,
  refreshed?: CodexRefreshState
): CodexPlanFilter | null =>
  normalizedPlanFilterValue(refreshed?.planType ?? resolveCodexPlanType(file));

/**
 * Compare two already-classified Codex files by availability, then priority,
 * then filename. The comparator intentionally does not inspect quota windows
 * or plan types; callers provide the current status classification.
 */
export const compareCodexAvailability = (
  left: AuthFileItem,
  right: AuthFileItem,
  leftStatus: CodexAccountStatusKind,
  rightStatus: CodexAccountStatusKind
): number => {
  const statusDifference =
    getCodexAvailabilityStatusRank(leftStatus) - getCodexAvailabilityStatusRank(rightStatus);
  if (statusDifference !== 0) return statusDifference;

  const leftPriority = parsePriorityValue(left.priority) ?? 0;
  const rightPriority = parsePriorityValue(right.priority) ?? 0;
  return rightPriority - leftPriority || left.name.localeCompare(right.name);
};

const isWindowFull = (window: CodexQuotaWindow, kind: string): boolean =>
  window.usedPercent !== null &&
  window.usedPercent >= 100 &&
  (window.id === kind || window.id.includes(kind));

const collectStatusText = (file: AuthFileItem, refreshed?: CodexRefreshState): string =>
  [
    refreshed?.error,
    file.disabled_reason,
    file.status_message,
    file.statusMessage,
    typeof file.error === 'string' ? file.error : '',
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

/**
 * The management API marks an intentional manual disable with this status message.
 * Older records may not have that marker, so a disabled file with no failure reason is
 * treated as manually parked. Automatic disables carry a failure in disabled_reason.
 */
export const isPurposefullyDisabled = (file: AuthFileItem): boolean =>
  file.disabled === true &&
  (String(file.status_message ?? file.statusMessage ?? '')
    .trim()
    .toLowerCase() === 'disabled via management api' ||
    String(file.disabled_reason ?? '').trim() === '');

/**
 * Classify Codex auth from persisted backend state and quota observations:
 * - denied: automatically disabled auth with a persisted failure reason
 * - cooldown: any quota window at 100% (rate/usage limit)
 * - working: healthy or manually parked auth (manual disables included)
 * - other: unavailable or other errors
 */
export const getCodexAccountStatus = (
  file: AuthFileItem,
  refreshed?: CodexRefreshState
): CodexAccountStatus => {
  const windows = refreshed?.windows ?? [];
  const fiveHourLimited = windows.some((window) => isWindowFull(window, 'five-hour'));
  const weeklyLimited = windows.some((window) => isWindowFull(window, 'weekly'));
  const monthlyLimited = windows.some((window) => isWindowFull(window, 'monthly'));
  const quotaLimited = fiveHourLimited || weeklyLimited || monthlyLimited;
  const purposefullyDisabled = isPurposefullyDisabled(file);

  const persistedStatusText = collectStatusText(file);
  const refreshStatusText = collectStatusText(file, refreshed);
  // usage_limit_reached is cooldown, not permanent denial. Refresh errors are
  // probe diagnostics and must not change the credential classification, except
  // that a refresh-only usage-limit response can still describe cooldown.
  const usageLimitOnly = [persistedStatusText, refreshStatusText].some(
    (text) => text.includes('usage_limit_reached') || text.includes('usage limit')
  );
  // Only persisted automatic auth diagnostics are authoritative for denial.
  // Manual disables remain intentionally parked and are handled below.
  const automaticDisable =
    file.disabled === true &&
    !purposefullyDisabled &&
    typeof file.disabled_reason === 'string' &&
    file.disabled_reason.trim() !== '';
  const needsReauth = automaticDisable;

  if (needsReauth) {
    return {
      kind: 'denied',
      needsReauth: true,
      quotaLimited,
      fiveHourLimited,
      weeklyLimited,
      monthlyLimited,
    };
  }

  if (quotaLimited || usageLimitOnly) {
    return {
      kind: 'cooldown',
      needsReauth: false,
      quotaLimited: true,
      fiveHourLimited,
      weeklyLimited,
      monthlyLimited,
    };
  }

  if (
    (file.disabled !== true || purposefullyDisabled) &&
    file.unavailable !== true &&
    (purposefullyDisabled || refreshed?.status !== 'error')
  ) {
    return {
      kind: 'working',
      needsReauth: false,
      quotaLimited: false,
      fiveHourLimited: false,
      weeklyLimited: false,
      monthlyLimited: false,
    };
  }

  return {
    kind: 'other',
    needsReauth: false,
    quotaLimited,
    fiveHourLimited,
    weeklyLimited,
    monthlyLimited,
  };
};

export const matchesCodexPlanFilter = (
  file: AuthFileItem,
  filter: CodexPlanFilter,
  refreshed?: CodexRefreshState
): boolean => {
  if (filter === 'all') return true;
  const value = getCodexPlanFilterValue(file, refreshed);
  return filter === 'unknown' ? value === null : value === filter;
};

/**
 * Map visible filter 'available' to internal 'working'; 'all' is special.
 * 'other' is internal and not a visible filter choice (remains under All).
 */
export const matchesCodexStatusFilter = (
  filter: CodexStatusFilter,
  file: AuthFileItem,
  refreshed?: CodexRefreshState
): boolean => {
  if (filter === 'all') return true;
  const status = getCodexAccountStatus(file, refreshed);
  if (filter === 'available') {
    return status.kind === 'working';
  }
  return status.kind === filter;
};
