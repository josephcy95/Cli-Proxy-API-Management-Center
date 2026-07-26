import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { IconRefreshCw, IconBot } from '@/components/ui/icons';
import { useUnsavedChangesGuard } from '@/hooks/useUnsavedChangesGuard';
import { modelContextApi } from '@/services/api/modelContext';
import { useAuthStore, useNotificationStore } from '@/stores';
import type { ModelContextEntry } from '@/types/modelContext';
import {
  buildModelContextDraftMap,
  collectOverrides,
  type ModelContextDraftMap,
  type ModelContextDraftValue,
} from '@/utils/modelContext';
import styles from './ModelContextPage.module.scss';

type FilterMode = 'missing' | 'overridden' | 'all';

type DraftValue = ModelContextDraftValue;
type DraftMap = ModelContextDraftMap;

export function ModelContextPage() {
  const { t } = useTranslation();
  const connectionStatus = useAuthStore((state) => state.connectionStatus);
  const showNotification = useNotificationStore((state) => state.showNotification);

  const [entries, setEntries] = useState<ModelContextEntry[]>([]);
  const [drafts, setDrafts] = useState<DraftMap>({});
  const [savedDrafts, setSavedDrafts] = useState<DraftMap>({});
  const [missingCount, setMissingCount] = useState(0);
  const [filter, setFilter] = useState<FilterMode>('missing');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const status = await modelContextApi.getStatus();
      const nextDrafts = buildModelContextDraftMap(status.models);
      setEntries(status.models);
      setDrafts(nextDrafts);
      setSavedDrafts(nextDrafts);
      setMissingCount(status.missingCount);
    } catch (loadError: unknown) {
      setError(loadError instanceof Error ? loadError.message : t('notification.refresh_failed'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const dirty = useMemo(
    () => JSON.stringify(drafts) !== JSON.stringify(savedDrafts),
    [drafts, savedDrafts]
  );

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

  const disabled = connectionStatus !== 'connected' || loading || saving;

  const updateDraft = useCallback((model: string, patch: Partial<DraftValue>) => {
    setDrafts((current) => ({
      ...current,
      [model]: { ...(current[model] ?? { contextLength: '', maxCompletionTokens: '' }), ...patch },
    }));
  }, []);

  const save = useCallback(async () => {
    setSaving(true);
    try {
      await modelContextApi.putOverrides(collectOverrides(entries, drafts));
      showNotification(t('model_context.save_success'), 'success');
      await load();
    } catch (saveError: unknown) {
      const message = saveError instanceof Error ? saveError.message : '';
      showNotification(`${t('notification.save_failed')}: ${message}`, 'error');
    } finally {
      setSaving(false);
    }
  }, [drafts, entries, load, showNotification, t]);

  const visibleEntries = useMemo(() => {
    const term = search.trim().toLowerCase();
    return entries.filter((entry) => {
      if (filter === 'missing' && entry.resolved) return false;
      if (filter === 'overridden' && !entry.overridden) return false;
      if (!term) return true;
      return (
        entry.model.toLowerCase().includes(term) ||
        entry.displayName.toLowerCase().includes(term) ||
        entry.providers.some((provider) => provider.toLowerCase().includes(term))
      );
    });
  }, [entries, filter, search]);

  const overriddenCount = useMemo(
    () => entries.filter((entry) => entry.overridden).length,
    [entries]
  );

  const statusText = error
    ? t('model_context.status_load_failed')
    : loading
      ? t('model_context.status_loading')
      : saving
        ? t('model_context.status_saving')
        : dirty
          ? t('model_context.status_dirty')
          : t('model_context.status_loaded');
  const statusClass = error ? styles.error : dirty ? styles.modified : styles.saved;

  const filterOptions: { id: FilterMode; label: string; count: number }[] = [
    { id: 'missing', label: t('model_context.filter_missing'), count: missingCount },
    { id: 'overridden', label: t('model_context.filter_overridden'), count: overriddenCount },
    { id: 'all', label: t('model_context.filter_all'), count: entries.length },
  ];

  return (
    <div className={styles.container}>
      <div className={styles.pageHeader}>
        <div>
          <div className={styles.titleRow}>
            <span className={styles.titleIcon} aria-hidden="true">
              <IconBot size={20} />
            </span>
            <h1>{t('model_context.title')}</h1>
          </div>
          <p>{t('model_context.description')}</p>
        </div>
        <div className={styles.headerActions}>
          <span className={`${styles.statusBadge} ${statusClass}`}>{statusText}</span>
          <Button variant="secondary" onClick={() => void load()} disabled={loading || saving}>
            <IconRefreshCw size={16} />
            {t('model_context.reload')}
          </Button>
          <Button onClick={() => void save()} disabled={disabled || !dirty} loading={saving}>
            {t('model_context.save')}
          </Button>
        </div>
      </div>

      {error && <div className="error-box">{error}</div>}

      <div className={styles.toolbar}>
        <div
          className={styles.filterGroup}
          role="tablist"
          aria-label={t('model_context.filter_all')}
        >
          {filterOptions.map((option) => (
            <button
              key={option.id}
              type="button"
              role="tab"
              aria-selected={filter === option.id}
              className={`${styles.filterChip} ${filter === option.id ? styles.filterChipActive : ''}`}
              onClick={() => setFilter(option.id)}
            >
              {option.label}
              <span className={styles.filterCount}>{option.count}</span>
            </button>
          ))}
        </div>
        <Input
          type="search"
          value={search}
          placeholder={t('model_context.search_placeholder')}
          onChange={(event) => setSearch(event.target.value)}
          aria-label={t('model_context.search_placeholder')}
        />
      </div>

      {missingCount > 0 && (
        <div className={styles.hintBox}>
          {t('model_context.missing_hint', { count: missingCount })}
        </div>
      )}

      {loading ? (
        <div className="hint">{t('common.loading')}</div>
      ) : visibleEntries.length === 0 ? (
        <div className={styles.emptyState}>
          {filter === 'missing'
            ? t('model_context.empty_missing')
            : t('model_context.empty_filtered')}
        </div>
      ) : (
        <div className={styles.modelList}>
          {visibleEntries.map((entry) => {
            const draft = drafts[entry.model] ?? { contextLength: '', maxCompletionTokens: '' };
            return (
              <div
                key={entry.model}
                className={`${styles.modelCard} ${entry.resolved ? '' : styles.modelCardMissing}`}
              >
                <div className={styles.modelInfo}>
                  <div className={styles.modelNameRow}>
                    <span className={styles.modelName}>{entry.model}</span>
                    {entry.overridden && (
                      <span className={styles.badgeOverride}>
                        {t('model_context.badge_override')}
                      </span>
                    )}
                    {!entry.resolved && (
                      <span className={styles.badgeMissing}>
                        {t('model_context.badge_missing')}
                      </span>
                    )}
                  </div>
                  <div className={styles.modelMeta}>
                    {entry.displayName && entry.displayName !== entry.model
                      ? `${entry.displayName} · `
                      : ''}
                    {entry.providers.length > 0
                      ? entry.providers.join(', ')
                      : t('model_context.provider_unknown')}
                  </div>
                </div>
                <div className={styles.modelInputs}>
                  <Input
                    type="number"
                    min="0"
                    step="1024"
                    label={t('model_context.context_length_label')}
                    value={draft.contextLength}
                    placeholder={t('model_context.value_unset')}
                    disabled={disabled}
                    onChange={(event) =>
                      updateDraft(entry.model, { contextLength: event.target.value })
                    }
                  />
                  <Input
                    type="number"
                    min="0"
                    step="1024"
                    label={t('model_context.max_completion_label')}
                    value={draft.maxCompletionTokens}
                    placeholder={t('model_context.value_unset')}
                    disabled={disabled}
                    onChange={(event) =>
                      updateDraft(entry.model, { maxCompletionTokens: event.target.value })
                    }
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
