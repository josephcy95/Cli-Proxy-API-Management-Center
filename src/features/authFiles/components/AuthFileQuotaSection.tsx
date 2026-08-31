import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
  ANTIGRAVITY_CONFIG,
  CLAUDE_CONFIG,
  CODEX_CONFIG,
  KIMI_CONFIG,
  QODERCN_CONFIG,
  QODER_CONFIG,
  XAI_CONFIG,
} from '@/components/quota';
import {
  codexQuotaHasAvailableCapacity,
  type CodexUsageSnapshot,
} from '@/components/quota/quotaConfigs';
import {
  captureQuotaCacheGeneration,
  commitIfQuotaCacheCurrent,
  useNotificationStore,
  useQuotaStore,
} from '@/stores';
import { authFilesApi } from '@/services/api';
import type { AuthFileItem, CodexQuotaState } from '@/types';
import {
  getStatusFromError,
  persistCodexQuotaSnapshot,
  codexQuotaPersistInputFromData,
  resolveCodexResetCredits,
  resolveCodexSubscriptionActiveUntil,
  formatShanghaiDateTime,
} from '@/utils/quota';
import { formatDateTimeValue, formatRelativeTimeLabel, toEpochMs } from '@/utils/format';
import {
  isRuntimeOnlyAuthFile,
  resolveQuotaErrorMessage,
  type QuotaProviderType,
} from '@/features/authFiles/constants';
import { IconRefreshCw } from '@/components/ui/icons';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { QuotaProgressBar } from '@/features/authFiles/components/QuotaProgressBar';
import styles from '@/pages/AuthFilesPage.module.scss';
import { getAuthFileAuthIndex } from '@/features/authFiles/cooldown';
import {
  mergeCodexQuotaWindows,
  persistedCodexQuotaWindows,
} from '@/features/authFiles/codexStatus';

export type AuthFileQuotaRefreshBinding = {
  refresh: () => void;
  canRefresh: boolean;
  loading: boolean;
};

type QuotaState = { status?: string; error?: string; errorStatus?: number } | undefined;

const assertNever = (value: never): never => {
  throw new Error(`Unsupported quota type: ${value}`);
};

const earliestResetCreditExpiry = (
  credits: { expiresAt?: string }[] | undefined
): string | null => {
  if (!credits || credits.length === 0) return null;
  let earliestMs = Infinity;
  let earliest: string | null = null;
  for (const credit of credits) {
    const expiresAt = credit.expiresAt;
    if (!expiresAt) continue;
    const ms = toEpochMs(expiresAt);
    if (ms == null) continue;
    if (ms < earliestMs) {
      earliestMs = ms;
      earliest = expiresAt;
    }
  }
  return earliest;
};

const persistedCodexQuotaState = (file: AuthFileItem, t: TFunction): CodexQuotaState | null => {
  const windows = persistedCodexQuotaWindows(file).map((window) => {
    const labelKey =
      window.id === 'weekly' ? 'codex_quota.secondary_window' : 'codex_quota.primary_window';
    return {
      ...window,
      label: t(labelKey),
      labelKey,
      resetLabel: window.resetAt ? formatRelativeTimeLabel(t, window.resetAt) : '-',
    };
  });
  return windows.length > 0 ? { status: 'success', windows } : null;
};

const getQuotaConfig = (type: QuotaProviderType) => {
  if (type === 'antigravity') return ANTIGRAVITY_CONFIG;
  if (type === 'claude') return CLAUDE_CONFIG;
  if (type === 'codex') return CODEX_CONFIG;
  if (type === 'kimi') return KIMI_CONFIG;
  if (type === 'qodercn') return QODERCN_CONFIG;
  if (type === 'qoder') return QODER_CONFIG;
  if (type === 'xai') return XAI_CONFIG;
  return assertNever(type);
};

export type AuthFileQuotaSectionProps = {
  file: AuthFileItem;
  quotaType: QuotaProviderType;
  compact?: boolean;
  disableControls: boolean;
  onAuthFileUpdated?: () => void | Promise<void>;
  /** Host card can place refresh in its action row to avoid an extra quota row. */
  onRefreshBindingChange?: (binding: AuthFileQuotaRefreshBinding | null) => void;
  onCodexRefreshStateReset?: (name: string) => void;
};

export function AuthFileQuotaSection(props: AuthFileQuotaSectionProps) {
  const {
    file,
    quotaType,
    compact = false,
    disableControls,
    onAuthFileUpdated,
    onCodexRefreshStateReset,
    onRefreshBindingChange,
  } = props;
  const { t } = useTranslation();
  const showNotification = useNotificationStore((state) => state.showNotification);
  const showConfirmation = useNotificationStore((state) => state.showConfirmation);
  const [resettingQuota, setResettingQuota] = useState(false);

  const liveQuota = useQuotaStore((state) => {
    if (quotaType === 'antigravity') return state.antigravityQuota[file.name] as QuotaState;
    if (quotaType === 'claude') return state.claudeQuota[file.name] as QuotaState;
    if (quotaType === 'codex') return state.codexQuota[file.name] as QuotaState;
    if (quotaType === 'kimi') return state.kimiQuota[file.name] as QuotaState;
    if (quotaType === 'qodercn' || quotaType === 'qoder')
      return state.qodercnQuota[file.name] as QuotaState;
    if (quotaType === 'xai') return state.xaiQuota[file.name] as QuotaState;
    return assertNever(quotaType);
  });

  const updateQuotaState = useQuotaStore((state) => {
    if (quotaType === 'antigravity')
      return state.setAntigravityQuota as unknown as (updater: unknown) => void;
    if (quotaType === 'claude')
      return state.setClaudeQuota as unknown as (updater: unknown) => void;
    if (quotaType === 'codex') return state.setCodexQuota as unknown as (updater: unknown) => void;
    if (quotaType === 'kimi') return state.setKimiQuota as unknown as (updater: unknown) => void;
    if (quotaType === 'qodercn' || quotaType === 'qoder')
      return state.setQoderCNQuota as unknown as (updater: unknown) => void;
    if (quotaType === 'xai') return state.setXaiQuota as unknown as (updater: unknown) => void;
    return assertNever(quotaType);
  });

  const persistedQuota = quotaType === 'codex' ? persistedCodexQuotaState(file, t) : null;
  const codexLiveQuota = liveQuota as (CodexQuotaState & QuotaState) | undefined;
  const quota =
    quotaType !== 'codex'
      ? liveQuota
      : codexLiveQuota?.status === 'loading'
        ? codexLiveQuota
        : codexLiveQuota?.status === 'success'
          ? {
              ...codexLiveQuota,
              windows: mergeCodexQuotaWindows(persistedQuota?.windows ?? [], codexLiveQuota.windows),
            }
          : persistedQuota ?? codexLiveQuota;

  const refreshQuotaForFile = useCallback(async () => {
    if (disableControls) return;
    if (isRuntimeOnlyAuthFile(file)) return;
    if (file.disabled) return;
    if (liveQuota?.status === 'loading') return;

    const config = getQuotaConfig(quotaType) as unknown as {
      i18nPrefix: string;
      fetchQuota: (file: AuthFileItem, t: TFunction) => Promise<unknown>;
      buildLoadingState: () => unknown;
      buildSuccessState: (data: unknown) => unknown;
      buildErrorState: (message: string, status?: number) => unknown;
      renderQuotaItems: (quota: unknown, t: TFunction, helpers: unknown) => unknown;
    };
    const cacheGeneration = captureQuotaCacheGeneration(file.name);

    updateQuotaState((prev: Record<string, unknown>) => ({
      ...prev,
      [file.name]: config.buildLoadingState(),
    }));

    try {
      let observedAt: string | null = null;
      if (quotaType === 'codex') {
        try {
          observedAt = (await authFilesApi.beginCodexQuotaRecovery()).observed_at ?? null;
        } catch {
          // Older servers can still display quota, but cannot safely auto-recover cooldowns.
        }
      }
      const data = await config.fetchQuota(file, t);
      let authFileChanged = false;
      const applied = commitIfQuotaCacheCurrent(cacheGeneration, () => {
        updateQuotaState((prev: Record<string, unknown>) => ({
          ...prev,
          [file.name]: config.buildSuccessState(data),
        }));
        showNotification(t('auth_files.quota_refresh_success', { name: file.name }), 'success');
      });
      if (applied && quotaType === 'codex') {
        if (observedAt && codexQuotaHasAvailableCapacity(data as CodexUsageSnapshot)) {
          const authIndex = getAuthFileAuthIndex(file);
          if (authIndex) {
            try {
              await authFilesApi.recoverCodexQuota(authIndex, observedAt);
              authFileChanged = true;
            } catch {
              // Keep the refreshed quota visible even if local cooldown clearing fails.
            }
          }
        }
        try {
          if (await persistCodexQuotaSnapshot(file.name, codexQuotaPersistInputFromData(data))) {
            authFileChanged = true;
          }
        } catch {
          // Quota display still succeeds if snapshot persistence fails.
        }
        if (authFileChanged) {
          if (quotaType === 'codex') onCodexRefreshStateReset?.(file.name);
          // Silent reload: avoid grid unmount flash from full loading state.
          await onAuthFileUpdated?.();
        }
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : t('common.unknown_error');
      const status = getStatusFromError(err);
      commitIfQuotaCacheCurrent(cacheGeneration, () => {
        updateQuotaState((prev: Record<string, unknown>) => ({
          ...prev,
          [file.name]: config.buildErrorState(message, status),
        }));
        showNotification(
          t('auth_files.quota_refresh_failed', { name: file.name, message }),
          'error'
        );
      });
    }
  }, [
    disableControls,
    file,
    onAuthFileUpdated,
    onCodexRefreshStateReset,
    liveQuota?.status,
    quotaType,
    showNotification,
    t,
    updateQuotaState,
  ]);

  const resetQuotaForFile = useCallback(() => {
    if (disableControls) return;
    if (isRuntimeOnlyAuthFile(file)) return;
    if (file.disabled) return;
    if (liveQuota?.status === 'loading') return;
    if (resettingQuota) return;

    const config = getQuotaConfig(quotaType) as unknown as {
      resetQuota?: (file: AuthFileItem, t: TFunction) => Promise<unknown>;
      buildSuccessState: (data: unknown) => unknown;
    };
    const resetQuota = config.resetQuota;
    if (!resetQuota) return;

    showConfirmation({
      title: t('codex_quota.reset_confirm_title'),
      message: t('codex_quota.reset_confirm_message', { name: file.name }),
      confirmText: t('codex_quota.reset_confirm_button'),
      variant: 'primary',
      onConfirm: async () => {
        const cacheGeneration = captureQuotaCacheGeneration(file.name);
        setResettingQuota(true);
        try {
          const data = await resetQuota(file, t);
          const applied = commitIfQuotaCacheCurrent(cacheGeneration, () => {
            updateQuotaState((prev: Record<string, unknown>) => ({
              ...prev,
              [file.name]: config.buildSuccessState(data),
            }));
            showNotification(t('codex_quota.reset_success', { name: file.name }), 'success');
          });
          if (applied) {
            try {
              await persistCodexQuotaSnapshot(file.name, codexQuotaPersistInputFromData(data));
            } catch {
              // Local consume already succeeded; keep the refreshed quota visible.
            }
            onCodexRefreshStateReset?.(file.name);
            await onAuthFileUpdated?.();
          }
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : t('common.unknown_error');
          commitIfQuotaCacheCurrent(cacheGeneration, () => {
            showNotification(t('codex_quota.reset_failed', { name: file.name, message }), 'error');
          });
        } finally {
          setResettingQuota(false);
        }
      },
    });
  }, [
    disableControls,
    file,
    onAuthFileUpdated,
    onCodexRefreshStateReset,
    liveQuota?.status,
    quotaType,
    resettingQuota,
    showConfirmation,
    showNotification,
    t,
    updateQuotaState,
  ]);

  const config = getQuotaConfig(quotaType) as unknown as {
    i18nPrefix: string;
    resetQuota?: (file: AuthFileItem, t: TFunction) => Promise<unknown>;
    canResetQuota?: (quota: unknown) => boolean;
    renderQuotaItems: (quota: unknown, t: TFunction, helpers: unknown) => unknown;
  };

  const quotaStatus = quota?.status ?? 'idle';
  const canRefreshQuota = !disableControls && !file.disabled && !resettingQuota;
  const canUseResetQuota = canRefreshQuota && quotaStatus !== 'loading';
  const quotaErrorMessage = resolveQuotaErrorMessage(
    t,
    quota?.errorStatus,
    quota?.error || t('common.unknown_error')
  );

  // Renewal and reset-credit availability are stored on the auth file, so they
  // survive a hard refresh. Live quota results are merged with that snapshot.
  const subscriptionActiveUntil =
    quotaType === 'codex' ? resolveCodexSubscriptionActiveUntil(file) : null;
  const renewalDisplay = subscriptionActiveUntil
    ? formatRelativeTimeLabel(t, subscriptionActiveUntil).replace(/^In\s+/i, '')
    : '';
  const renewalTitle = subscriptionActiveUntil ? formatDateTimeValue(subscriptionActiveUntil) : '';
  const fileResetCredits = quotaType === 'codex' ? resolveCodexResetCredits(file) : null;
  // Reset-credit metadata comes from the persisted auth-file snapshot. The
  // in-memory quota response may be partial/failed and must not hide a known
  // credit until the next auth-files reload.
  const resetCredits = fileResetCredits;
  const resetCreditsCount = resetCredits?.availableCount ?? 0;
  const showResetCredits = quotaType === 'codex' && resetCreditsCount > 0;
  const resetCreditExpiry = earliestResetCreditExpiry(resetCredits?.credits);
  const resetCreditExpiryDisplay = resetCreditExpiry
    ? formatRelativeTimeLabel(t, resetCreditExpiry).replace(/^In\s+/i, '')
    : '';
  const resetCreditsTitle =
    resetCredits?.credits && resetCredits.credits.length > 0
      ? resetCredits.credits
          .map((credit, index) => {
            const expiresAt = credit.expiresAt ?? '';
            const when =
              formatShanghaiDateTime(expiresAt) || formatDateTimeValue(expiresAt) || expiresAt;
            return `${t('codex_quota.reset_credit_number', { index: index + 1 })}: ${when}`;
          })
          .join('\n')
      : resetCreditExpiry
        ? formatDateTimeValue(resetCreditExpiry)
        : '';
  const showResetQuotaAction = Boolean(config.resetQuota) && showResetCredits;
  const resetQuotaAction = showResetQuotaAction ? (
    <button
      type="button"
      className={styles.quotaResetInlineButton}
      onClick={() => resetQuotaForFile()}
      disabled={!canUseResetQuota}
      title={t('codex_quota.reset_button')}
      aria-label={t('codex_quota.reset_button')}
    >
      {resettingQuota ? <LoadingSpinner size={10} /> : <IconRefreshCw size={12} />}
    </button>
  ) : undefined;
  const showCodexMeta = renewalDisplay || showResetCredits;

  useEffect(() => {
    if (!onRefreshBindingChange) return;
    onRefreshBindingChange({
      refresh: () => {
        void refreshQuotaForFile();
      },
      canRefresh: canRefreshQuota && quotaStatus !== 'loading',
      loading: quotaStatus === 'loading',
    });
    return () => onRefreshBindingChange(null);
  }, [canRefreshQuota, onRefreshBindingChange, quotaStatus, refreshQuotaForFile]);

  if (compact) return null;

  return (
    <div className={styles.quotaSection}>
      {showCodexMeta && (
        <div className={styles.codexPlan}>
          {renewalDisplay && (
            <span className={styles.codexPlanItem} title={renewalTitle || undefined}>
              <span className={styles.codexPlanLabel}>{t('codex_quota.renew_label')}</span>
              <span className={styles.codexPlanValue}>{renewalDisplay}</span>
            </span>
          )}
          {showResetCredits && (
            <span className={styles.codexPlanItem} title={resetCreditsTitle || undefined}>
              <span className={styles.codexPlanLabel}>{t('codex_quota.reset_credits_short')}</span>
              <span className={styles.codexPlanValue}>
                {resetCreditsCount}
                {resetCreditExpiryDisplay ? (
                  <span className={styles.codexPlanExpiry}>· {resetCreditExpiryDisplay}</span>
                ) : null}
                {resetQuotaAction}
              </span>
            </span>
          )}
        </div>
      )}
      {quotaStatus === 'loading' ? (
        <div className={styles.quotaMessage}>{t(`${config.i18nPrefix}.loading`)}</div>
      ) : quotaStatus === 'idle' ? (
        <button
          type="button"
          className={`${styles.quotaMessage} ${styles.quotaMessageAction}`}
          onClick={() => void refreshQuotaForFile()}
          disabled={!canRefreshQuota}
        >
          {t(`${config.i18nPrefix}.idle`)}
        </button>
      ) : quotaStatus === 'error' ? (
        <div className={styles.quotaError}>
          {t(`${config.i18nPrefix}.load_failed`, {
            message: quotaErrorMessage,
          })}
        </div>
      ) : quota ? (
        (config.renderQuotaItems(quota, t, {
          styles,
          QuotaProgressBar,
          card: true,
          hideResetCredits: true,
        }) as ReactNode)
      ) : (
        <div className={styles.quotaMessage}>{t(`${config.i18nPrefix}.idle`)}</div>
      )}
    </div>
  );
}
