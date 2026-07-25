import type { AuthFileItem } from '@/types';
import { normalizeAuthIndex } from '@/utils/authIndex';
import { isRuntimeOnlyAuthFile, normalizeProviderKey } from '@/features/authFiles/constants';
import {
  getCodexAccountStatus,
  type CodexRefreshState,
} from '@/features/authFiles/codexStatus';
import { getXaiAccountStatus } from '@/features/authFiles/xaiStatus';

const COOLDOWN_MESSAGE_RE =
  /usage[_\s-]?limit|rate[_\s-]?limit|cooldown|quota\s*exceed|temporary|retry\s*after|resets[_\s-]?at/i;

const readFutureDate = (value: unknown, nowMs: number): Date | null => {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.getTime() > nowMs ? parsed : null;
};

export const getAuthFileAuthIndex = (file: AuthFileItem): string | null =>
  normalizeAuthIndex(file.auth_index ?? file.authIndex);

const collectStatusText = (file: AuthFileItem): string =>
  [
    file.disabled_reason,
    file.status_message,
    file.statusMessage,
    file.status,
    (file as { last_error?: unknown }).last_error,
  ]
    .filter((value) => value != null && String(value).trim() !== '')
    .map((value) => String(value))
    .join(' ');

export type CanResetAuthCooldownOptions = {
  nowMs?: number;
  /** Live Codex usage windows from the page refresh helper. */
  codexRefresh?: CodexRefreshState;
};

/**
 * True when this auth file looks locally cooled down / quota-blocked and can be
 * unlocked via POST /reset-quota. Permanently disabled files are excluded.
 */
export const canResetAuthCooldown = (
  file: AuthFileItem,
  nowMsOrOptions: number | CanResetAuthCooldownOptions = Date.now()
): boolean => {
  const options: CanResetAuthCooldownOptions =
    typeof nowMsOrOptions === 'number' ? { nowMs: nowMsOrOptions } : nowMsOrOptions ?? {};
  const nowMs = options.nowMs ?? Date.now();

  if (!file || isRuntimeOnlyAuthFile(file)) return false;
  if (file.disabled === true) return false;
  if (!getAuthFileAuthIndex(file)) return false;

  const provider = normalizeProviderKey(String(file.type ?? file.provider ?? ''));

  if (provider === 'xai') {
    const status = getXaiAccountStatus(file, nowMs);
    if (status.kind === 'cooldown' || status.kind === 'other_403') return true;
  }

  if (provider === 'codex') {
    const status = getCodexAccountStatus(file, options.codexRefresh);
    if (status.kind === 'cooldown') return true;
  }

  if (file.unavailable === true) return true;

  if (readFutureDate(file.xai_cooldown_until, nowMs)) return true;
  if (readFutureDate(file.next_retry_after ?? file.nextRetryAfter, nowMs)) return true;

  const statusText = collectStatusText(file);
  if (statusText && COOLDOWN_MESSAGE_RE.test(statusText)) return true;

  return false;
};

export const listResettableCooldownFiles = (
  files: AuthFileItem[],
  options?: number | CanResetAuthCooldownOptions | ((file: AuthFileItem) => CanResetAuthCooldownOptions)
): AuthFileItem[] =>
  files.filter((file) => {
    if (typeof options === 'function') return canResetAuthCooldown(file, options(file));
    return canResetAuthCooldown(file, options);
  });
