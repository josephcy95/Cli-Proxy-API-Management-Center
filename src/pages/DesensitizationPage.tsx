import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import { IconRefreshCw, IconShield } from '@/components/ui/icons';
import { useUnsavedChangesGuard } from '@/hooks/useUnsavedChangesGuard';
import { apiKeysApi } from '@/services/api/apiKeys';
import { configApi } from '@/services/api/config';
import { providersApi } from '@/services/api/providers';
import { useAuthStore, useNotificationStore } from '@/stores';
import type {
  DesensitizationCategories,
  DesensitizationConfig,
  DesensitizationPreviewHit,
  DesensitizationScope,
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

const DEFAULT_OAUTH_IDS = [
  'claude',
  'gemini',
  'aistudio',
  'antigravity',
  'codex',
  'kimi',
  'xai',
  'qoder',
  'qodercn',
  'vertex',
] as const;

const DEFAULT_API_IDS = [
  'claude',
  'gemini',
  'codex',
  'xai',
  'gemini-interactions',
  'vertex',
] as const;

const DEFAULT_SECRET_PREFIXES = ['sk-', 'ghp_', 'github_pat_', 'xoxb-', 'AKIA'];

const DEFAULT_CONFIG: DesensitizationConfig = {
  enabled: false,
  scope: 'all',
  api_keys: [],
  oauth_providers: [],
  api_providers: [],
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
  secret_prefixes: [...DEFAULT_SECRET_PREFIXES],
  skip_models: [],
  skip_formats: [],
};

function sameConfig(a: DesensitizationConfig, b: DesensitizationConfig): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function maskClientKey(key: string): string {
  const value = key.trim();
  if (value.length <= 4) return `…${value}`;
  return `…${value.slice(-4)}`;
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    const value = raw.trim();
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

function toggleList(list: string[], value: string, selected: boolean): string[] {
  const next = list.filter((item) => item !== value);
  if (selected) next.push(value);
  return next;
}

function ChipEditor({
  values,
  disabled,
  placeholder,
  addLabel,
  onChange,
}: {
  values: string[];
  disabled: boolean;
  placeholder: string;
  addLabel: string;
  onChange: (next: string[]) => void;
}) {
  const [draft, setDraft] = useState('');
  const add = () => {
    const value = draft.trim();
    if (!value) return;
    onChange(uniqueStrings([...values, value]));
    setDraft('');
  };
  return (
    <div>
      <div className={styles.chipRow}>
        {values.map((value) => (
          <span className={styles.chip} key={value}>
            <code>{value}</code>
            <button
              type="button"
              onClick={() => onChange(values.filter((item) => item !== value))}
              disabled={disabled}
              aria-label={value}
            >
              ×
            </button>
          </span>
        ))}
      </div>
      <div className={styles.termRow}>
        <Input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={placeholder}
          disabled={disabled}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              add();
            }
          }}
        />
        <Button variant="secondary" onClick={add} disabled={disabled || !draft.trim()}>
          {addLabel}
        </Button>
      </div>
    </div>
  );
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
  const [previewText, setPreviewText] = useState(
    '联系我 13800138000 或 user@example.com，密钥 sk-abcdefghijklmnopqrstuvwxyz012345'
  );
  const [previewMasked, setPreviewMasked] = useState('');
  const [previewHits, setPreviewHits] = useState<DesensitizationPreviewHit[]>([]);
  const [previewing, setPreviewing] = useState(false);
  const [termDraft, setTermDraft] = useState('');
  const [regexPattern, setRegexPattern] = useState('');
  const [regexCategory, setRegexCategory] = useState('CUSTOM');
  const [clientKeys, setClientKeys] = useState<string[]>([]);
  const [oauthOptions, setOauthOptions] = useState<string[]>([...DEFAULT_OAUTH_IDS]);
  const [apiOptions, setApiOptions] = useState<string[]>([...DEFAULT_API_IDS]);

  const disabled = connectionStatus !== 'connected' || loading || saving;
  const dirty = !sameConfig(draft, saved);
  const targetedEmpty =
    draft.enabled &&
    draft.scope === 'targeted' &&
    draft.api_keys.length === 0 &&
    draft.oauth_providers.length === 0 &&
    draft.api_providers.length === 0;
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
      const [next, keys, scope, compat] = await Promise.all([
        configApi.getDesensitizationConfig(),
        apiKeysApi.list().catch(() => [] as string[]),
        configApi.getDesensitizationScopeOptions().catch(() => ({
          api_keys: [] as string[],
          oauth_providers: [...DEFAULT_OAUTH_IDS],
          api_providers: [...DEFAULT_API_IDS],
        })),
        providersApi.getOpenAIProviders().catch(() => [] as { name?: string }[]),
      ]);
      setDraft(next);
      setSaved(next);
      setClientKeys(uniqueStrings([...scope.api_keys, ...keys, ...next.api_keys]));
      setOauthOptions(uniqueStrings([...DEFAULT_OAUTH_IDS, ...scope.oauth_providers, ...next.oauth_providers]));
      const compatNames = compat.map((item) => String(item.name ?? '').trim()).filter(Boolean);
      setApiOptions(
        uniqueStrings([...DEFAULT_API_IDS, ...scope.api_providers, ...compatNames, ...next.api_providers])
      );
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

  const addRegex = () => {
    const pattern = regexPattern.trim();
    if (!pattern) return;
    update({
      custom_regex: [
        ...draft.custom_regex,
        { pattern, category: regexCategory.trim() || 'CUSTOM' },
      ],
    });
    setRegexPattern('');
    setRegexCategory('CUSTOM');
  };

  const setScope = (scope: DesensitizationScope) => update({ scope });

  const providerLabel = (id: string, group: 'oauth' | 'api') => {
    const key = `desensitization.provider.${id}`;
    const translated = t(key);
    if (translated !== key) return translated;
    if (group === 'api' && id === 'gemini-interactions') {
      return t('desensitization.provider.interactions');
    }
    return id;
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
          <h2>{t('desensitization.apply_to_title')}</h2>
          <p>{t('desensitization.apply_to_hint')}</p>
          <div className={styles.segmented} role="radiogroup" aria-label={t('desensitization.apply_to_title')}>
            <button
              type="button"
              className={draft.scope === 'all' ? styles.segmentActive : styles.segment}
              onClick={() => setScope('all')}
              disabled={disabled}
              aria-pressed={draft.scope === 'all'}
            >
              {t('desensitization.scope_all')}
            </button>
            <button
              type="button"
              className={draft.scope === 'targeted' ? styles.segmentActive : styles.segment}
              onClick={() => setScope('targeted')}
              disabled={disabled}
              aria-pressed={draft.scope === 'targeted'}
            >
              {t('desensitization.scope_targeted')}
            </button>
          </div>
          {draft.scope === 'targeted' && (
            <>
              <p className={styles.mixtureHint}>{t('desensitization.mixture_hint')}</p>
              {targetedEmpty && <div className={styles.warning}>{t('desensitization.targeted_empty_warning')}</div>}

              <div className={styles.scopeGroup}>
                <h3>{t('desensitization.client_keys_title')}</h3>
                <p>{t('desensitization.client_keys_hint')}</p>
                {clientKeys.length === 0 ? (
                  <p className={styles.emptyHint}>{t('desensitization.client_keys_empty')}</p>
                ) : (
                  <div className={styles.checkGrid}>
                    {clientKeys.map((key) => (
                      <label className={styles.checkItem} key={key}>
                        <input
                          type="checkbox"
                          checked={draft.api_keys.includes(key)}
                          onChange={(event) =>
                            update({ api_keys: toggleList(draft.api_keys, key, event.target.checked) })
                          }
                          disabled={disabled}
                        />
                        <span title={t('desensitization.client_key_full_hidden')}>{maskClientKey(key)}</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>

              <div className={styles.scopeGroup}>
                <h3>{t('desensitization.oauth_title')}</h3>
                <p>{t('desensitization.oauth_hint')}</p>
                <div className={styles.checkGrid}>
                  {oauthOptions.map((id) => (
                    <label className={styles.checkItem} key={id}>
                      <input
                        type="checkbox"
                        checked={draft.oauth_providers.some((item) => item.toLowerCase() === id.toLowerCase())}
                        onChange={(event) =>
                          update({
                            oauth_providers: toggleList(draft.oauth_providers, id, event.target.checked),
                          })
                        }
                        disabled={disabled}
                      />
                      <span>{providerLabel(id, 'oauth')}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div className={styles.scopeGroup}>
                <h3>{t('desensitization.api_providers_title')}</h3>
                <p>{t('desensitization.api_providers_hint')}</p>
                <div className={styles.checkGrid}>
                  {apiOptions.map((id) => (
                    <label className={styles.checkItem} key={id}>
                      <input
                        type="checkbox"
                        checked={draft.api_providers.some((item) => item.toLowerCase() === id.toLowerCase())}
                        onChange={(event) =>
                          update({
                            api_providers: toggleList(draft.api_providers, id, event.target.checked),
                          })
                        }
                        disabled={disabled}
                      />
                      <span>{providerLabel(id, 'api')}</span>
                    </label>
                  ))}
                </div>
              </div>
            </>
          )}
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
          <h2>{t('desensitization.custom_rules_title')}</h2>
          <p>{t('desensitization.custom_rules_hint')}</p>

          <div className={styles.scopeGroup}>
            <h3>{t('desensitization.custom_terms_title')}</h3>
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

          <div className={styles.scopeGroup}>
            <h3>{t('desensitization.custom_regex_title')}</h3>
            <p>{t('desensitization.custom_regex_hint')}</p>
            <div className={styles.termRow}>
              <Input
                value={regexPattern}
                onChange={(event) => setRegexPattern(event.target.value)}
                placeholder={t('desensitization.custom_regex_placeholder')}
                disabled={disabled}
              />
              <Input
                value={regexCategory}
                onChange={(event) => setRegexCategory(event.target.value)}
                placeholder={t('desensitization.custom_regex_category')}
                disabled={disabled}
              />
              <Button variant="secondary" onClick={addRegex} disabled={disabled || !regexPattern.trim()}>
                {t('desensitization.add_regex')}
              </Button>
            </div>
            {draft.custom_regex.map((rule, index) => (
              <div className={styles.termRow} key={`${rule.pattern}-${index}`}>
                <code>{rule.pattern}</code>
                <span>{rule.category}</span>
                <Button
                  variant="secondary"
                  onClick={() =>
                    update({
                      custom_regex: draft.custom_regex.filter((_, i) => i !== index),
                    })
                  }
                  disabled={disabled}
                >
                  {t('common.delete')}
                </Button>
              </div>
            ))}
          </div>

          <div className={styles.scopeGroup}>
            <h3>{t('desensitization.secret_prefixes_title')}</h3>
            <p>{t('desensitization.secret_prefixes_hint')}</p>
            <ChipEditor
              values={draft.secret_prefixes}
              disabled={disabled}
              placeholder={t('desensitization.secret_prefix_placeholder')}
              addLabel={t('desensitization.add_prefix')}
              onChange={(secret_prefixes) => update({ secret_prefixes })}
            />
          </div>

          <div className={styles.scopeGroup}>
            <h3>{t('desensitization.skip_models_title')}</h3>
            <p>{t('desensitization.skip_models_hint')}</p>
            <ChipEditor
              values={draft.skip_models}
              disabled={disabled}
              placeholder={t('desensitization.skip_models_placeholder')}
              addLabel={t('desensitization.add_skip')}
              onChange={(skip_models) => update({ skip_models })}
            />
          </div>

          <div className={styles.scopeGroup}>
            <h3>{t('desensitization.skip_formats_title')}</h3>
            <p>{t('desensitization.skip_formats_hint')}</p>
            <ChipEditor
              values={draft.skip_formats}
              disabled={disabled}
              placeholder={t('desensitization.skip_formats_placeholder')}
              addLabel={t('desensitization.add_skip')}
              onChange={(skip_formats) => update({ skip_formats })}
            />
          </div>
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
