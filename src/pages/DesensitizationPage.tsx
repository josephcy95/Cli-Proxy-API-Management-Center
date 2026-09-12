import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
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
  group: 'core' | 'extra';
  highFp?: boolean;
}[] = [
  { key: 'api_key', group: 'core' },
  { key: 'token', group: 'core' },
  { key: 'private_key', group: 'core' },
  { key: 'connstr', group: 'core' },
  { key: 'email', group: 'core' },
  { key: 'phone', group: 'core' },
  { key: 'idcard', group: 'core' },
  { key: 'card', group: 'extra', highFp: true },
  { key: 'jwt', group: 'extra', highFp: true },
  { key: 'ip_private', group: 'extra', highFp: true },
  { key: 'ip_internal', group: 'extra', highFp: true },
  { key: 'mac', group: 'extra', highFp: true },
  { key: 'plate', group: 'extra', highFp: true },
  { key: 'landline', group: 'extra', highFp: true },
  { key: 'access_key', group: 'extra', highFp: true },
  { key: 'secret_assignment', group: 'extra', highFp: true },
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
    <div className={styles.chipEditor}>
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
  const [compatNames, setCompatNames] = useState<string[]>([]);

  const disabled = connectionStatus !== 'connected' || loading || saving;
  const dirty = !sameConfig(draft, saved);
  const targetedEmpty =
    draft.enabled &&
    draft.scope === 'targeted' &&
    draft.api_keys.length === 0 &&
    draft.oauth_providers.length === 0 &&
    draft.api_providers.length === 0;
  const selectedKeyCount = draft.api_keys.filter((key) =>
    clientKeys.some((item) => item === key || item.toLowerCase() === key.toLowerCase())
  ).length;
  const selectedCompatCount = draft.api_providers.filter((name) =>
    compatNames.some((item) => item.toLowerCase() === name.toLowerCase())
  ).length;
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
          api_providers: [] as string[],
        })),
        providersApi.getOpenAIProviders().catch(() => [] as { name?: string }[]),
      ]);
      setDraft(next);
      setSaved(next);
      setClientKeys(uniqueStrings([...scope.api_keys, ...keys, ...next.api_keys]));
      setOauthOptions(uniqueStrings([...DEFAULT_OAUTH_IDS, ...scope.oauth_providers, ...next.oauth_providers]));
      const names = compat.map((item) => String(item.name ?? '').trim()).filter(Boolean);
      setCompatNames(uniqueStrings(names));
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

  const coreCategories = CATEGORY_META.filter((item) => item.group === 'core');
  const extraCategories = CATEGORY_META.filter((item) => item.group === 'extra');

  const renderDetector = ({ key, highFp }: (typeof CATEGORY_META)[number]) => (
    <label
      className={styles.detector}
      key={key}
      title={t(`desensitization.cat_help.${key}`)}
    >
      <span className={styles.detectorName}>
        {t(`desensitization.cat.${key}`)}
        {highFp ? <em>{t('desensitization.high_fp')}</em> : null}
      </span>
      <ToggleSwitch
        checked={draft.categories[key]}
        onChange={(value) => update({ categories: { ...draft.categories, [key]: value } })}
        disabled={disabled}
        ariaLabel={t(`desensitization.cat.${key}`)}
      />
    </label>
  );

  return (
    <div className={styles.container}>
      <header className={styles.pageHeader}>
        <div className={styles.titleBlock}>
          <div className={styles.titleRow}>
            <span className={styles.titleIcon} aria-hidden="true">
              <IconShield size={18} />
            </span>
            <h1>{t('desensitization.title')}</h1>
            <span className={`${styles.statusBadge} ${statusClass}`}>{statusText}</span>
          </div>
          <p>{t('desensitization.description')}</p>
        </div>
        <div className={styles.headerActions}>
          <Button variant="secondary" onClick={reload} disabled={loading || saving}>
            <IconRefreshCw size={16} />
            {t('desensitization.reload')}
          </Button>
          <Button onClick={save} disabled={disabled || !dirty} loading={saving}>
            {t('desensitization.save')}
          </Button>
        </div>
      </header>

      {error && <div className="error-box">{error}</div>}

      <section className={styles.card}>
        <div className={styles.cardHead}>
          <div>
            <h2>{t('desensitization.policy_title')}</h2>
            <p>{t('desensitization.policy_hint')}</p>
          </div>
          <label className={styles.ttl}>
            <span>{t('desensitization.session_ttl')}</span>
            <input
              type="number"
              min={1}
              step={1}
              value={draft.session_ttl_minutes}
              disabled={disabled}
              onChange={(event) => {
                const parsed = Number.parseInt(event.target.value, 10);
                update({ session_ttl_minutes: Number.isFinite(parsed) ? Math.max(1, parsed) : 20 });
              }}
            />
          </label>
        </div>
        <div className={styles.policyGrid}>
          {(
            [
              ['enabled', draft.enabled, (enabled: boolean) => update({ enabled })],
              ['restore', draft.restore, (restore: boolean) => update({ restore })],
              ['restore_secrets', draft.restore_secrets, (restore_secrets: boolean) => update({ restore_secrets })],
              ['fail_closed', draft.fail_closed, (fail_closed: boolean) => update({ fail_closed })],
            ] as const
          ).map(([key, checked, onChange]) => (
            <div className={styles.policyCell} key={key}>
              <div>
                <strong>{t(`desensitization.${key}`)}</strong>
                <p>{t(`desensitization.${key}_hint`)}</p>
              </div>
              <ToggleSwitch
                checked={checked}
                onChange={onChange}
                disabled={disabled}
                ariaLabel={t(`desensitization.${key}`)}
              />
            </div>
          ))}
        </div>
      </section>

      <section className={styles.card}>
        <div className={styles.cardHead}>
          <div>
            <h2>{t('desensitization.apply_to_title')}</h2>
            <p>{t('desensitization.apply_to_hint')}</p>
          </div>
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
        </div>
        {draft.scope === 'targeted' && (
          <div className={styles.scopeBody}>
            {targetedEmpty && <div className={styles.warning}>{t('desensitization.targeted_empty_warning')}</div>}
            <div className={styles.scopeLinks}>
              <div className={styles.scopeLink}>
                <div>
                  <strong>{t('desensitization.client_keys_title')}</strong>
                  <p>{t('desensitization.client_keys_hint')}</p>
                </div>
                <div className={styles.scopeLinkMeta}>
                  <b>
                    {t('desensitization.scope_count', {
                      enabled: selectedKeyCount,
                      total: clientKeys.length,
                    })}
                  </b>
                  <Link to="/config">{t('desensitization.client_keys_manage')}</Link>
                </div>
              </div>
              <div className={styles.scopeLink}>
                <div>
                  <strong>{t('desensitization.api_providers_title')}</strong>
                  <p>{t('desensitization.api_providers_hint')}</p>
                </div>
                <div className={styles.scopeLinkMeta}>
                  <b>
                    {t('desensitization.scope_count', {
                      enabled: selectedCompatCount,
                      total: compatNames.length,
                    })}
                  </b>
                  <Link to="/ai-providers">{t('desensitization.api_providers_manage')}</Link>
                </div>
              </div>
            </div>
            <div>
              <div className={styles.sectionLabel}>{t('desensitization.oauth_title')}</div>
              <p className={styles.sectionHint}>{t('desensitization.mixture_hint')}</p>
              <div className={styles.oauthChips}>
                {oauthOptions.map((id) => {
                  const selected = draft.oauth_providers.some(
                    (item) => item.toLowerCase() === id.toLowerCase()
                  );
                  return (
                    <button
                      type="button"
                      key={id}
                      className={selected ? styles.oauthOn : styles.oauthOff}
                      disabled={disabled}
                      aria-pressed={selected}
                      onClick={() =>
                        update({ oauth_providers: toggleList(draft.oauth_providers, id, !selected) })
                      }
                    >
                      {providerLabel(id, 'oauth')}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </section>

      <section className={styles.card}>
        <div className={styles.cardHead}>
          <div>
            <h2>{t('desensitization.categories_title')}</h2>
            <p>{t('desensitization.categories_hint')}</p>
          </div>
        </div>
        <div className={styles.detectorGroups}>
          <div>
            <div className={styles.sectionLabel}>{t('desensitization.categories_core')}</div>
            <div className={styles.detectorList}>{coreCategories.map(renderDetector)}</div>
          </div>
          <div>
            <div className={styles.sectionLabel}>{t('desensitization.categories_extra')}</div>
            <div className={styles.detectorList}>{extraCategories.map(renderDetector)}</div>
          </div>
        </div>
      </section>

      <div className={styles.split}>
        <section className={styles.card}>
          <div className={styles.cardHead}>
            <div>
              <h2>{t('desensitization.custom_rules_title')}</h2>
              <p>{t('desensitization.custom_rules_hint')}</p>
            </div>
          </div>
          <div className={styles.rulesGrid}>
            <div className={styles.ruleBlock}>
              <div className={styles.sectionLabel}>{t('desensitization.custom_terms_title')}</div>
              <div className={styles.chipRow}>
                {draft.custom_terms.map((term, index) => (
                  <span className={styles.chip} key={`${term.value}-${index}`}>
                    <code>{term.value}</code>
                    <button
                      type="button"
                      disabled={disabled}
                      aria-label={term.value}
                      onClick={() =>
                        update({ custom_terms: draft.custom_terms.filter((_, i) => i !== index) })
                      }
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
              <div className={styles.addRow}>
                <Input
                  value={termDraft}
                  onChange={(event) => setTermDraft(event.target.value)}
                  placeholder={t('desensitization.custom_term_placeholder')}
                  disabled={disabled}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      addTerm();
                    }
                  }}
                />
                <Button variant="secondary" onClick={addTerm} disabled={disabled || !termDraft.trim()}>
                  {t('desensitization.add_term')}
                </Button>
              </div>
            </div>
            <div className={styles.ruleBlock}>
              <div className={styles.sectionLabel}>{t('desensitization.custom_regex_title')}</div>
              <div className={styles.chipRow}>
                {draft.custom_regex.map((rule, index) => (
                  <span className={styles.chip} key={`${rule.pattern}-${index}`}>
                    <code>{rule.pattern}</code>
                    <button
                      type="button"
                      disabled={disabled}
                      aria-label={rule.pattern}
                      onClick={() =>
                        update({ custom_regex: draft.custom_regex.filter((_, i) => i !== index) })
                      }
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
              <div className={styles.addRow}>
                <Input
                  value={regexPattern}
                  onChange={(event) => setRegexPattern(event.target.value)}
                  placeholder={t('desensitization.custom_regex_placeholder')}
                  disabled={disabled}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      addRegex();
                    }
                  }}
                />
                <Button variant="secondary" onClick={addRegex} disabled={disabled || !regexPattern.trim()}>
                  {t('desensitization.add_regex')}
                </Button>
              </div>
            </div>
            <div className={styles.ruleBlock}>
              <div className={styles.sectionLabel}>{t('desensitization.secret_prefixes_title')}</div>
              <ChipEditor
                values={draft.secret_prefixes}
                disabled={disabled}
                placeholder={t('desensitization.secret_prefix_placeholder')}
                addLabel={t('desensitization.add_prefix')}
                onChange={(secret_prefixes) => update({ secret_prefixes })}
              />
            </div>
            <div className={styles.ruleBlock}>
              <div className={styles.sectionLabel}>{t('desensitization.skip_models_title')}</div>
              <ChipEditor
                values={draft.skip_models}
                disabled={disabled}
                placeholder={t('desensitization.skip_models_placeholder')}
                addLabel={t('desensitization.add_skip')}
                onChange={(skip_models) => update({ skip_models })}
              />
            </div>
            <div className={`${styles.ruleBlock} ${styles.ruleWide}`}>
              <div className={styles.sectionLabel}>{t('desensitization.skip_formats_title')}</div>
              <ChipEditor
                values={draft.skip_formats}
                disabled={disabled}
                placeholder={t('desensitization.skip_formats_placeholder')}
                addLabel={t('desensitization.add_skip')}
                onChange={(skip_formats) => update({ skip_formats })}
              />
            </div>
          </div>
        </section>

        <section className={styles.card}>
          <div className={styles.cardHead}>
            <div>
              <h2>{t('desensitization.preview_title')}</h2>
              <p>{t('desensitization.preview_hint')}</p>
            </div>
            <Button onClick={runPreview} loading={previewing} disabled={connectionStatus !== 'connected'}>
              {t('desensitization.preview_run')}
            </Button>
          </div>
          <div className={styles.previewGrid}>
            <textarea
              value={previewText}
              onChange={(event) => setPreviewText(event.target.value)}
              disabled={connectionStatus !== 'connected' || previewing}
            />
            <div className={styles.previewResult}>{previewMasked || t('desensitization.preview_empty')}</div>
          </div>
          {previewHits.length > 0 && (
            <div className={styles.hits}>
              {previewHits.map((hit) => (
                <span className={styles.hit} key={hit.category}>
                  {hit.category} × {hit.count}
                </span>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
