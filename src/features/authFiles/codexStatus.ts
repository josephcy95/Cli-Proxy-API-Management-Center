import { parsePriorityValue } from '@/features/authFiles/constants';
import type { AuthFileItem, CodexAdaptiveCandidateInfo, CodexQuotaWindow } from '@/types';
import {
  normalizeNumberValue,
  normalizePlanType,
  resolveCodexPlanType,
  resolveCodexResetCredits,
  resolveCodexSubscriptionActiveUntil,
} from '@/utils/quota';
import { toEpochMs } from '@/utils/format';

export const CODEX_PLAN_FILTERS = ['all', 'free', 'paid'] as const;

/** Visible status filters. `other` remains an internal classification for All and sorting. */
export const CODEX_STATUS_FILTERS = ['all', 'available', 'cooldown', 'denied'] as const;

export type CodexPlanFilter = (typeof CODEX_PLAN_FILTERS)[number];
type CodexPlanValue = 'free' | 'k12' | 'plus' | 'team' | 'prolite' | 'pro';
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

const normalizedPlanFilterValue = (value: string | null): CodexPlanValue | null => {
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
): CodexPlanValue | null =>
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

const readFileValue = (file: AuthFileItem, key: string): unknown => {
  const metadata = file.metadata && typeof file.metadata === 'object' ? file.metadata : null;
  const quota = file.quota && typeof file.quota === 'object' ? file.quota : null;
  const signals =
    quota && typeof (quota as Record<string, unknown>).signals === 'object'
      ? ((quota as Record<string, unknown>).signals as Record<string, unknown>)
      : null;
  return (
    file[key] ??
    (metadata as Record<string, unknown> | null)?.[key] ??
    (quota as Record<string, unknown> | null)?.[key] ??
    signals?.[key]
  );
};

const readFileNumber = (file: AuthFileItem, key: string): number | null =>
  normalizeNumberValue(readFileValue(file, key));

const readPersistedObservedAt = (file: AuthFileItem): number | null => {
  const direct = readFileValue(file, 'codex_quota_observed_at') ?? readFileValue(file, 'codexQuotaObservedAt');
  if (direct != null) return toEpochMs(direct);
  const quota = file.quota && typeof file.quota === 'object' ? file.quota : null;
  return toEpochMs((quota as Record<string, unknown> | null)?.observed_at);
};

const persistedWindow = (
  file: AuthFileItem,
  prefix: 'Primary' | 'Secondary',
  fallbackId: 'five-hour' | 'weekly',
  now = Date.now()
): CodexQuotaWindow | null => {
  const usedPercent = readFileNumber(file, `X-Codex-${prefix}-Used-Percent`);
  if (usedPercent === null) return null;
  const windowMinutes = readFileNumber(file, `X-Codex-${prefix}-Window-Minutes`);
  const resolvedId =
    windowMinutes !== null && windowMinutes > 0
      ? windowMinutes >= 10080
        ? 'weekly'
        : 'five-hour'
      : fallbackId;
  const resetAtValue = readFileNumber(file, `X-Codex-${prefix}-Reset-At`);
  const resetAfterSeconds = readFileNumber(file, `X-Codex-${prefix}-Reset-After-Seconds`);
  const observedAt = readPersistedObservedAt(file);
  const candidateResetAt =
    resetAtValue !== null && resetAtValue > 0
      ? resetAtValue < 1e11
        ? resetAtValue * 1000
        : resetAtValue
      : resetAfterSeconds !== null && resetAfterSeconds > 0 && observedAt !== null
        ? observedAt + resetAfterSeconds * 1000
        : null;
  const resetAt =
    candidateResetAt !== null &&
    candidateResetAt > now - 14 * 24 * 60 * 60 * 1000 &&
    candidateResetAt < now + 14 * 24 * 60 * 60 * 1000
      ? candidateResetAt
      : null;
  return {
    id: resolvedId,
    label: resolvedId === 'weekly' ? 'Weekly' : 'Five hours',
    usedPercent: Math.max(0, Math.min(100, usedPercent)),
    resetLabel: '-',
    resetAt,
  };
};

export const persistedCodexQuotaWindows = (
  file: AuthFileItem,
  now = Date.now()
): CodexQuotaWindow[] =>
  [
    persistedWindow(file, 'Primary', 'five-hour', now),
    persistedWindow(file, 'Secondary', 'weekly', now),
  ].filter((window): window is CodexQuotaWindow => window !== null);

export const mergeCodexQuotaWindows = (
  persisted: CodexQuotaWindow[],
  live: CodexQuotaWindow[]
): CodexQuotaWindow[] => {
  const merged = new Map<string, CodexQuotaWindow>();
  persisted.forEach((window) => merged.set(window.id, window));
  live.forEach((window) => merged.set(window.id, window));
  return Array.from(merged.values());
};

const isWindowFull = (window: CodexQuotaWindow, kind: string, now = Date.now()): boolean =>
  window.usedPercent !== null &&
  window.usedPercent >= 100 &&
  (window.resetAt == null || window.resetAt > now) &&
  (window.id === kind || window.id.includes(kind));

const persistedWindowLimited = (
  file: AuthFileItem,
  prefix: 'Primary' | 'Secondary',
  kind: 'five-hour' | 'weekly',
  now: number
): boolean => {
  const window = persistedWindow(file, prefix, kind, now);
  const resetAt = window?.resetAt ?? null;
  const resetIsActive = resetAt == null || resetAt > now;
  const used = readFileNumber(file, `X-Codex-${prefix}-Used-Percent`);
  const limitReached = String(readFileValue(file, `X-Codex-${prefix}-Limit-Reached`) ?? '')
    .trim()
    .toLowerCase();
  const allowed = String(readFileValue(file, `X-Codex-${prefix}-Allowed`) ?? '')
    .trim()
    .toLowerCase();
  return (
    resetIsActive &&
    ((used !== null && used >= 100) ||
      limitReached === 'true' ||
      limitReached === '1' ||
      limitReached === 'yes' ||
      allowed === 'false' ||
      allowed === '0' ||
      allowed === 'no')
  );
};

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
  refreshed?: CodexRefreshState,
  now = Date.now()
): CodexAccountStatus => {
  const persistedWindows = persistedCodexQuotaWindows(file, now);
  const liveWindows = refreshed?.windows ?? [];
  const windows = mergeCodexQuotaWindows(persistedWindows, liveWindows);
  const fiveHourLimited =
    windows.some((window) => isWindowFull(window, 'five-hour', now)) ||
    (!liveWindows.some((window) => window.id === 'five-hour') &&
      persistedWindowLimited(file, 'Primary', 'five-hour', now));
  const weeklyLimited =
    windows.some((window) => isWindowFull(window, 'weekly', now)) ||
    (!liveWindows.some((window) => window.id === 'weekly') &&
      persistedWindowLimited(file, 'Secondary', 'weekly', now));
  const monthlyLimited = windows.some((window) => isWindowFull(window, 'monthly', now));
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

export type CodexAdaptiveSortScore = {
  candidate: boolean;
  status: number;
  deadline: number | null;
  urgency: number;
  priority: number;
};

const isCodexAdaptiveCandidate = (
  file: AuthFileItem,
  refreshed: CodexRefreshState | undefined,
  now: number
): boolean => {
  const status = getCodexAccountStatus(file, refreshed, now);
  const nextRetryAt = toEpochMs(file.next_retry_after ?? file.nextRetryAfter);
  return (
    status.kind === 'working' &&
    file.disabled !== true &&
    file.unavailable !== true &&
    (nextRetryAt == null || nextRetryAt <= now)
  );
};

const codexAdaptiveScore = (
  file: AuthFileItem,
  now: number,
  refreshed?: CodexRefreshState
): CodexAdaptiveSortScore => {
  const windows = mergeCodexQuotaWindows(
    persistedCodexQuotaWindows(file, now),
    refreshed?.windows ?? []
  );
  const weekly = windows.find((window) => window.id === 'weekly');
  // Adaptive backend scoring is based on the weekly window. A five-hour-only
  // snapshot must not invent a different deadline or urgency in the UI.
  const used = weekly?.usedPercent ?? 0;
  const remaining = Math.max(0, Math.min(100, 100 - used));
  const resetCredits = resolveCodexResetCredits(file);
  const resetCreditExpiry = resetCredits.credits.reduce<number | null>((earliest, credit) => {
    const value = toEpochMs(credit.expiresAt);
    return value != null && value > now && (earliest == null || value < earliest)
      ? value
      : earliest;
  }, null);
  const subscriptionExpiry = toEpochMs(resolveCodexSubscriptionActiveUntil(file));
  const weeklyResetAt = weekly?.resetAt ?? null;
  const deadlines = [weeklyResetAt, resetCreditExpiry, subscriptionExpiry].filter(
    (value): value is number => value != null && Number.isFinite(value) && value > now
  );
  const deadline = deadlines.length > 0 ? Math.min(...deadlines) : null;
  const hours = deadline ? Math.max((deadline - now) / 3_600_000, 1 / 24) : 168;
  const usableRemaining = remaining === 0 && resetCredits.availableCount > 0 ? 1 : remaining;
  const candidate = isCodexAdaptiveCandidate(file, refreshed, now);
  return {
    candidate,
    status: getCodexAvailabilityStatusRank(getCodexAccountStatus(file, refreshed, now).kind),
    deadline,
    urgency: (usableRemaining * (1 + Math.min(resetCredits.availableCount, 2))) / hours,
    priority: parsePriorityValue(file.priority) ?? 0,
  };
};

const readAdaptiveInfo = (file: AuthFileItem): CodexAdaptiveCandidateInfo | null => {
  const value = file.codex_adaptive;
  return value && typeof value === 'object' ? value : null;
};

const compareAdaptiveScores = (
  left: CodexAdaptiveSortScore,
  right: CodexAdaptiveSortScore,
  leftFile: AuthFileItem,
  rightFile: AuthFileItem,
  leftLoad = 0,
  rightLoad = 0
): number => {
  if (left.candidate !== right.candidate) return left.candidate ? -1 : 1;
  if (left.status !== right.status) return left.status - right.status;
  if (left.deadline !== right.deadline) {
    if (left.deadline == null) return 1;
    if (right.deadline == null) return -1;
    return left.deadline - right.deadline;
  }
  if (Math.abs(left.urgency - right.urgency) > 0.000001) {
    return right.urgency - left.urgency;
  }
  if (left.priority !== right.priority) return right.priority - left.priority;
  if (leftLoad !== rightLoad) return leftLoad - rightLoad;
  return fileSortKey(leftFile).localeCompare(fileSortKey(rightFile));
};

const compareAuthoritativeAdaptive = (
  left: AuthFileItem,
  right: AuthFileItem,
  leftRefreshed: CodexRefreshState | undefined,
  rightRefreshed: CodexRefreshState | undefined,
  now: number
): number | null => {
  const a = readAdaptiveInfo(left);
  const b = readAdaptiveInfo(right);
  if (!a || !b || typeof a.candidate !== 'boolean' || typeof b.candidate !== 'boolean') {
    return null;
  }

  const leftScore = codexAdaptiveScore(left, now, leftRefreshed);
  const rightScore = codexAdaptiveScore(right, now, rightRefreshed);
  leftScore.candidate = a.candidate && leftScore.candidate;
  rightScore.candidate = b.candidate && rightScore.candidate;

  // Candidate/blocked state and live load come from the backend. Recalculate the
  // order from the quota and expiry shown on the cards so a stale snapshot rank
  // cannot disagree with both the visible data and the request-time router.
  return compareAdaptiveScores(
    leftScore,
    rightScore,
    left,
    right,
    normalizeNumberValue(a.in_flight) ?? 0,
    normalizeNumberValue(b.in_flight) ?? 0
  );
};

export const compareCodexAdaptive = (
  left: AuthFileItem,
  right: AuthFileItem,
  now = Date.now(),
  leftRefreshed?: CodexRefreshState,
  rightRefreshed?: CodexRefreshState
): number => {
  const authoritative = compareAuthoritativeAdaptive(
    left,
    right,
    leftRefreshed,
    rightRefreshed,
    now
  );
  if (authoritative !== null) return authoritative;

  return compareAdaptiveScores(
    codexAdaptiveScore(left, now, leftRefreshed),
    codexAdaptiveScore(right, now, rightRefreshed),
    left,
    right
  );
};

const fileSortKey = (file: AuthFileItem): string => `${file.name}\u0000${file.id ?? ''}`;

export const matchesCodexPlanFilter = (
  file: AuthFileItem,
  filter: CodexPlanFilter,
  refreshed?: CodexRefreshState
): boolean => {
  if (filter === 'all') return true;
  const value = getCodexPlanFilterValue(file, refreshed);
  return filter === 'free' ? value === 'free' : value !== null && value !== 'free';
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
