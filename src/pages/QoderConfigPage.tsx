import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import { IconRefreshCw, IconShield } from '@/components/ui/icons';
import { useUnsavedChangesGuard } from '@/hooks/useUnsavedChangesGuard';
import { configApi } from '@/services/api/config';
import { useAuthStore, useNotificationStore } from '@/stores';
import type { QoderConfig } from '@/types';
import styles from './XAIConfigPage.module.scss';

const DEFAULT_QODER_CONFIG: QoderConfig = {
  autoDisableInactiveToken: true,
  queuedForbiddenCooldownMinutes: 5,
};

function normalizeConfig(config: QoderConfig): QoderConfig {
  return {
    autoDisableInactiveToken: config.autoDisableInactiveToken !== false,
    queuedForbiddenCooldownMinutes: Math.max(
      0,
      Math.floor(config.queuedForbiddenCooldownMinutes || 0)
    ),
  };
}

function sameConfig(left: QoderConfig, right: QoderConfig): boolean {
  return JSON.stringify(normalizeConfig(left)) === JSON.stringify(normalizeConfig(right));
}

export function QoderConfigPage() {
  const { t } = useTranslation();
  const connectionStatus = useAuthStore((state) => state.connectionStatus);
  const showNotification = useNotificationStore((state) => state.showNotification);
  const showConfirmation = useNotificationStore((state) => state.showConfirmation);
  const [draft, setDraft] = useState<QoderConfig>(DEFAULT_QODER_CONFIG);
  const [saved, setSaved] = useState<QoderConfig>(DEFAULT_QODER_CONFIG);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const disabled = connectionStatus !== 'connected' || loading || saving;
  const dirty = !sameConfig(draft, saved);
  const statusText = error
    ? t('qoder_config.status_load_failed')
    : loading
      ? t('qoder_config.status_loading')
      : saving
        ? t('qoder_config.status_saving')
        : dirty
          ? t('qoder_config.status_dirty')
          : t('qoder_config.status_loaded');
  const statusClass = error ? styles.error : dirty ? styles.modified : styles.saved;

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const next = normalizeConfig(await configApi.getQoderConfig());
      setDraft(next);
      setSaved(next);
    } catch (loadError: unknown) {
      setError(loadError instanceof Error ? loadError.message : t('notification.refresh_failed'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const unsavedDialog = useMemo(
    () => ({
      title: t('common.unsaved_changes_title'),
      message: t('common.unsaved_changes_message'),
      confirmText: t('common.confirm'),
      cancelText: t('common.cancel'),
    }),
    [t]
  );
  useUnsavedChangesGuard({ shouldBlock: dirty, dialog: unsavedDialog });

  const reload = useCallback(() => {
    if (!dirty) {
      void load();
      return;
    }
    showConfirmation({
      title: t('common.unsaved_changes_title'),
      message: t('qoder_config.reload_confirm_message'),
      confirmText: t('qoder_config.reload'),
      cancelText: t('common.cancel'),
      variant: 'danger',
      onConfirm: async () => load(),
    });
  }, [dirty, load, showConfirmation, t]);

  const save = useCallback(async () => {
    const next = normalizeConfig(draft);
    setSaving(true);
    try {
      await configApi.updateQoderConfig(next);
      setDraft(next);
      setSaved(next);
      showNotification(t('qoder_config.save_success'), 'success');
    } catch (saveError: unknown) {
      const message = saveError instanceof Error ? saveError.message : '';
      showNotification(`${t('notification.save_failed')}: ${message}`, 'error');
    } finally {
      setSaving(false);
    }
  }, [draft, showNotification, t]);

  const updateCooldown = (value: string) => {
    const parsed = Number.parseInt(value, 10);
    setDraft((current) => ({
      ...current,
      queuedForbiddenCooldownMinutes: Number.isFinite(parsed) ? Math.max(0, parsed) : 0,
    }));
  };

  return (
    <div className={styles.container}>
      <div className={styles.pageHeader}>
        <div>
          <div className={styles.titleRow}>
            <span className={styles.titleIcon} aria-hidden="true">
              <IconShield size={20} />
            </span>
            <h1>{t('qoder_config.title')}</h1>
          </div>
          <p>{t('qoder_config.description')}</p>
        </div>
        <div className={styles.headerActions}>
          <span className={`${styles.statusBadge} ${statusClass}`}>{statusText}</span>
          <Button variant="secondary" onClick={reload} disabled={loading || saving}>
            <IconRefreshCw size={16} />
            {t('qoder_config.reload')}
          </Button>
          <Button onClick={save} disabled={disabled || !dirty} loading={saving}>
            {t('qoder_config.save')}
          </Button>
        </div>
      </div>

      {error && <div className="error-box">{error}</div>}

      <div className={styles.policyStrip} aria-label={t('qoder_config.policy_summary')}>
        <span>{t('qoder_config.policy_inactive_token')}</span>
        <span>
          {t('qoder_config.policy_queued', { minutes: draft.queuedForbiddenCooldownMinutes })}
        </span>
      </div>

      <section className={styles.settings} aria-label={t('qoder_config.settings_title')}>
        <div className={styles.settingCard}>
          <div className={styles.settingHeader}>
            <div>
              <h2>{t('qoder_config.auto_disable_label')}</h2>
              <p>{t('qoder_config.auto_disable_hint')}</p>
            </div>
            <ToggleSwitch
              checked={draft.autoDisableInactiveToken}
              onChange={(autoDisableInactiveToken) =>
                setDraft((current) => ({ ...current, autoDisableInactiveToken }))
              }
              disabled={disabled}
              ariaLabel={t('qoder_config.auto_disable_label')}
            />
          </div>
          <div className={styles.reasonNote}>{t('qoder_config.reason_note')}</div>
        </div>

        <div className={styles.settingCard}>
          <h2>{t('qoder_config.queued_403_label')}</h2>
          <p>{t('qoder_config.queued_403_hint')}</p>
          <Input
            type="number"
            min="0"
            step="1"
            label={t('qoder_config.cooldown_minutes')}
            value={String(draft.queuedForbiddenCooldownMinutes)}
            onChange={(event) => updateCooldown(event.target.value)}
            disabled={disabled}
          />
        </div>
      </section>
    </div>
  );
}
