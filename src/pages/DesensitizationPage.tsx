import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import { IconRefreshCw, IconShield } from '@/components/ui/icons';
import { useUnsavedChangesGuard } from '@/hooks/useUnsavedChangesGuard';
import { configApi } from '@/services/api/config';
import { useAuthStore, useNotificationStore } from '@/stores';
import type {
  DesensitizationCategories,
  DesensitizationConfig,
  DesensitizationPreviewHit,
} from '@/types';
import styles from './DesensitizationPage.module.scss';

const CATEGORY_META: {
  key: keyof DesensitizationCategories;
  highFp?: boolean;
}[] = [
  { key: 'api_key' },
  { key: 'token' },
  { key: 'private_key' },
  { key: 'connstr' },
  { key: 'email' },
  { key: 'phone' },
  { key: 'idcard' },
  { key: 'card', highFp: true },
  { key: 'jwt', highFp: true },
  { key: 'ip_private', highFp: true },
  { key: 'ip_internal', highFp: true },
  { key: 'mac', highFp: true },
  { key: 'plate', highFp: true },
  { key: 'landline', highFp: true },
  { key: 'access_key', highFp: true },
  { key: 'secret_assignment', highFp: true },
];

const DEFAULT_CONFIG: DesensitizationConfig = {
  enabled: false,
  restore: true,
  restore_secrets: false,
  fail_closed: false,
  session_ttl_minutes: 20,
  categories: {
    api_key: true,
    token: true,
    private_key: true,
    connstr: true,
    email: true,
    phone: true,
    idcard: true,
    card: false,
    jwt: false,
    ip_private: false,
    ip_internal: false,
    mac: false,
    plate: false,
    landline: false,
    access_key: false,
    secret_assignment: false,
  },
  custom_terms: [],
  custom_regex: [],
  secret_prefixes: ['sk-', 'ghp_', 'github_pat_', 'xoxb-', 'AKIA'],
  skip_models: [],
  skip_formats: [],
};

function sameConfig(a: DesensitizationConfig, b: DesensitizationConfig): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function DesensitizationPage() {
  const { t } = useTranslation();
  const connectionStatus = useAuthStore((state) => state.connectionStatus);
  const showNotification = useNotificationStore((state) => state.showNotification);
  const showConfirmation = useNotificationStore((state) => state.showConfirmation);
  const [draft, setDraft] = useState<DesensitizationConfig>(DEFAULT_CONFIG);
  const [saved, setSaved] = useState<DesensitizationConfig>(DEFAULT_CONFIG);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [previewText, setPreviewText] = useState('联系我 13800138000 或 user@example.com，密钥 sk-abcdefghijklmnopqrstuvwxyz012345');
  const [previewMasked, setPreviewMasked] = useState('');
  const [previewHits, setPreviewHits] = useState<DesensitizationPreviewHit[]>([]);
  const [previewing, setPreviewing] = useState(false);
  const [termDraft, setTermDraft] = useState('');

  const disabled = connectionStatus !== 'connected' || loading || saving;
  const dirty = !sameConfig(draft, saved);
  const statusText = error
    ? t('desensitization.status_load_failed')
    : loading
      ? t('desensitization.status_loading')
      : saving
        ? t('desensitization.status_saving')
        : dirty
          ? t('desensitization.status_dirty')
          : t('desensitization.status_loaded');
  const statusClass = error ? styles.error : dirty ? styles.modified : styles.saved;

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const next = await configApi.getDesensitizationConfig();
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

  const update = useCallback((patch: Partial<DesensitizationConfig>) => {
    setDraft((current) => ({ ...current, ...patch }));
  }, []);

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
      message: t('desensitization.reload_confirm_message'),
      confirmText: t('desensitization.reload'),
      cancelText: t('common.cancel'),
      variant: 'danger',
      onConfirm: async () => load(),
    });
  }, [dirty, load, showConfirmation, t]);

  const save = useCallback(async () => {
    setSaving(true);
    try {
      const next = await configApi.updateDesensitizationConfig(draft);
      setDraft(next);
      setSaved(next);
      showNotification(t('desensitization.save_success'), 'success');
    } catch (saveError: unknown) {
      const message = saveError instanceof Error ? saveError.message : '';
      showNotification(`${t('notification.save_failed')}: ${message}`, 'error');
    } finally {
      setSaving(false);
    }
  }, [draft, showNotification, t]);

  const runPreview = useCallback(async () => {
    setPreviewing(true);
    try {
      const result = await configApi.previewDesensitization(previewText);
      setPreviewMasked(result.masked);
      setPreviewHits(result.hits);
    } catch (previewError: unknown) {
      const message = previewError instanceof Error ? previewError.message : '';
      showNotification(`${t('desensitization.preview_failed')}: ${message}`, 'error');
    } finally {
      setPreviewing(false);
    }
  }, [previewText, showNotification, t]);

  const addTerm = () => {
    const value = termDraft.trim();
    if (!value) return;
    update({
      custom_terms: [...draft.custom_terms, { value, category: 'TERM', whole_word: true }],
    });
    setTermDraft('');
  };

  return (
    <div className={styles.container}>
      <div className={styles.pageHeader}>
        <div>
          <div className={styles.titleRow}>
            <span className={styles.titleIcon} aria-hidden="true">
              <IconShield size={20} />
            </span>
            <h1>{t('desensitization.title')}</h1>
          </div>
          <p>{t('desensitization.description')}</p>
        </div>
        <div className={styles.headerActions}>
          <span className={`${styles.statusBadge} ${statusClass}`}>{statusText}</span>
          <Button variant="secondary" onClick={reload} disabled={loading || saving}>
            <IconRefreshCw size={16} />
            {t('desensitization.reload')}
          </Button>
          <Button onClick={save} disabled={disabled || !dirty} loading={saving}>
            {t('desensitization.save')}
          </Button>
        </div>
      </div>

      {error && <div className="error-box">{error}</div>}

      <section className={styles.settings}>
        <div className={styles.settingCard}>
          <div className={styles.toggleGrid}>
            <div className={styles.settingHeader}>
              <div>
                <h2>{t('desensitization.enabled')}</h2>
                <p>{t('desensitization.enabled_hint')}</p>
              </div>
              <ToggleSwitch
                checked={draft.enabled}
                onChange={(enabled) => update({ enabled })}
                disabled={disabled}
                ariaLabel={t('desensitization.enabled')}
              />
            </div>
            <div className={styles.settingHeader}>
              <div>
                <h2>{t('desensitization.restore')}</h2>
                <p>{t('desensitization.restore_hint')}</p>
              </div>
              <ToggleSwitch
                checked={draft.restore}
                onChange={(restore) => update({ restore })}
                disabled={disabled}
                ariaLabel={t('desensitization.restore')}
              />
            </div>
            <div className={styles.settingHeader}>
              <div>
                <h2>{t('desensitization.restore_secrets')}</h2>
                <p>{t('desensitization.restore_secrets_hint')}</p>
              </div>
              <ToggleSwitch
                checked={draft.restore_secrets}
                onChange={(restore_secrets) => update({ restore_secrets })}
                disabled={disabled}
                ariaLabel={t('desensitization.restore_secrets')}
              />
            </div>
            <div className={styles.settingHeader}>
              <div>
                <h2>{t('desensitization.fail_closed')}</h2>
                <p>{t('desensitization.fail_closed_hint')}</p>
              </div>
              <ToggleSwitch
                checked={draft.fail_closed}
                onChange={(fail_closed) => update({ fail_closed })}
                disabled={disabled}
                ariaLabel={t('desensitization.fail_closed')}
              />
            </div>
          </div>
          <div style={{ marginTop: 14, maxWidth: 240 }}>
            <Input
              type="number"
              min="1"
              step="1"
              label={t('desensitization.session_ttl')}
              value={String(draft.session_ttl_minutes)}
              onChange={(event) => {
                const parsed = Number.parseInt(event.target.value, 10);
                update({ session_ttl_minutes: Number.isFinite(parsed) ? Math.max(1, parsed) : 20 });
              }}
              disabled={disabled}
            />
          </div>
        </div>

        <div className={styles.settingCard}>
          <h2>{t('desensitization.categories_title')}</h2>
          <p>{t('desensitization.categories_hint')}</p>
          <div className={styles.categoryGrid}>
            {CATEGORY_META.map(({ key, highFp }) => (
              <div className={styles.categoryItem} key={key}>
                <div>
                  <strong>{t(`desensitization.cat.${key}`)}</strong>
                  <span className={highFp ? styles.fp : undefined}>
                    {t(`desensitization.cat_help.${key}`)}
                    {highFp ? ` · ${t('desensitization.high_fp')}` : ''}
                  </span>
                </div>
                <ToggleSwitch
                  checked={draft.categories[key]}
                  onChange={(value) =>
                    update({ categories: { ...draft.categories, [key]: value } })
                  }
                  disabled={disabled}
                  ariaLabel={t(`desensitization.cat.${key}`)}
                />
              </div>
            ))}
          </div>
        </div>

        <div className={styles.settingCard}>
          <h2>{t('desensitization.custom_terms_title')}</h2>
          <p>{t('desensitization.custom_terms_hint')}</p>
          <div className={styles.termRow}>
            <Input
              value={termDraft}
              onChange={(event) => setTermDraft(event.target.value)}
              placeholder={t('desensitization.custom_term_placeholder')}
              disabled={disabled}
            />
            <Button variant="secondary" onClick={addTerm} disabled={disabled || !termDraft.trim()}>
              {t('desensitization.add_term')}
            </Button>
          </div>
          {draft.custom_terms.map((term, index) => (
            <div className={styles.termRow} key={`${term.value}-${index}`}>
              <code>{term.value}</code>
              <span>{term.category}</span>
              <Button
                variant="secondary"
                onClick={() =>
                  update({
                    custom_terms: draft.custom_terms.filter((_, i) => i !== index),
                  })
                }
                disabled={disabled}
              >
                {t('common.delete')}
              </Button>
            </div>
          ))}
        </div>

        <div className={styles.settingCard}>
          <h2>{t('desensitization.preview_title')}</h2>
          <p>{t('desensitization.preview_hint')}</p>
          <div className={styles.previewBox}>
            <textarea
              value={previewText}
              onChange={(event) => setPreviewText(event.target.value)}
              disabled={connectionStatus !== 'connected' || previewing}
            />
            <div>
              <Button onClick={runPreview} loading={previewing} disabled={connectionStatus !== 'connected'}>
                {t('desensitization.preview_run')}
              </Button>
            </div>
            <div className={styles.previewResult}>{previewMasked || t('desensitization.preview_empty')}</div>
            <div className={styles.hits}>
              {previewHits.map((hit) => (
                <span className={styles.hit} key={hit.category}>
                  {hit.category} × {hit.count}
                </span>
              ))}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
