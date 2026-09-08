import type { AuthFileItem } from '@/types';
import { isRuntimeOnlyAuthFile, normalizeProviderKey } from '@/features/authFiles/constants';
import { getAuthFileAuthIndex } from '@/features/authFiles/cooldown';

/** True when a Codex credential can be usage/reset-credit refreshed. */
export const canRefreshCodexData = (file: AuthFileItem): boolean => {
  if (!file || isRuntimeOnlyAuthFile(file)) return false;
  if (normalizeProviderKey(String(file.type ?? file.provider ?? '')) !== 'codex') return false;
  return Boolean(getAuthFileAuthIndex(file));
};

/** Filter the current auth-file result set down to Codex refresh targets. */
export const listCodexRefreshableFiles = (files: AuthFileItem[]): AuthFileItem[] =>
  files.filter(canRefreshCodexData);
