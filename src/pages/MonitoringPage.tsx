import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/Table';
import { IconX } from '@/components/ui/icons';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import {
  usageEventsApi,
  type ModelPrice,
  type ModelPriceAlias,
  type PriceSyncCandidateSet,
  type PriceSyncResult,
  type UsageAccountStat,
  type UsageAPIKeyStat,
  type UsageEvent,
  type UsageFilterOptions,
  type UsageQuery,
  type UsageSummary,
} from '@/services/api/usageEvents';
import { configFileApi } from '@/services/api/configFile';
import { apiClient } from '@/services/api/client';
import { parseApiKeyEntries } from '@/hooks/useVisualConfig';
import { useNotificationStore } from '@/stores';
import { getErrorMessage } from '@/utils/helpers';
import { isScalar, isSeq, parseDocument } from 'yaml';
import styles from './MonitoringPage.module.scss';

type RangeKey = '24h' | '7d' | '14d' | '30d' | 'all';
type TabKey = 'realtime' | 'accounts' | 'api_keys' | 'prices';
type PriceListFilter = 'all' | 'manual' | 'synced' | 'unpriced';

/** Parse optional display names stored as YAML EOL comments on api-keys. */
const parseApiKeyLabelMap = (yamlText: string): Record<string, string> => {
  const map: Record<string, string> = {};
  try {
    const doc = parseDocument(yamlText);
    const node = doc.getIn(['api-keys'], true);
    if (isSeq(node)) {
      for (const item of node.items) {
        if (!isScalar(item)) continue;
        const key = String(item.value ?? '').trim();
        if (!key) continue;
        const name = String(item.comment ?? '')
          .replace(/^\s*/, '')
          .trim();
        if (name) map[key] = name;
      }
      return map;
    }
  } catch {
    // fall through
  }
  // Fallback: plain list without comments
  try {
    for (const entry of parseApiKeyEntries(yamlText)) {
      if (entry.key && entry.name) map[entry.key] = entry.name;
    }
  } catch {
    // ignore
  }
  return map;
};

const AUTO_OPTIONS = [
  { label: 'Off', value: '0' },
  { label: '5s', value: '5000' },
  { label: '10s', value: '10000' },
  { label: '30s', value: '30000' },
] as const;

const MS_PER_HOUR = 60 * 60 * 1000;
const MS_PER_DAY = 24 * MS_PER_HOUR;

const rangeToMs = (key: RangeKey): { from_ms?: number; to_ms?: number } => {
  const now = Date.now();
  if (key === 'all') return {};
  if (key === '24h') return { from_ms: now - 24 * MS_PER_HOUR, to_ms: now };
  const days = key === '7d' ? 7 : key === '14d' ? 14 : 30;
  return { from_ms: now - days * MS_PER_DAY, to_ms: now };
};

const formatNumber = (value: number | undefined | null, digits = 0) => {
  if (value === undefined || value === null || !Number.isFinite(value)) return '—';
  return new Intl.NumberFormat(undefined, {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits > 0 ? Math.min(digits, 2) : 0,
  }).format(value);
};

const formatUsd = (value: number | undefined | null) => {
  if (value === undefined || value === null || !Number.isFinite(value) || value <= 0) return '—';
  if (value < 0.01) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(2)}`;
};

const formatDuration = (ms: number | null | undefined) => {
  if (ms === null || ms === undefined || !Number.isFinite(ms) || ms < 0) return '—';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
};

const formatTime = (ms: number) => {
  if (!ms) return '—';
  return new Date(ms).toLocaleString();
};

const formatTokensCompact = (e: UsageEvent) => {
  const parts = [`I ${formatNumber(e.input_tokens)}`, `O ${formatNumber(e.output_tokens)}`];
  if (e.reasoning_tokens) parts.push(`R ${formatNumber(e.reasoning_tokens)}`);
  if (e.cache_read_tokens || e.cached_tokens) {
    parts.push(`C ${formatNumber(e.cache_read_tokens || e.cached_tokens)}`);
  }
  return parts.join(' · ');
};

const formatRate = (value: number | undefined | null) => {
  if (value === undefined || value === null || !Number.isFinite(value)) return '—';
  return formatNumber(value, 4);
};

const isManualSource = (source?: string) => {
  const s = (source || '').toLowerCase();
  return s === '' || s === 'manual' || s === 'override';
};

export function MonitoringPage() {
  const { t } = useTranslation();
  const showNotification = useNotificationStore((s) => s.showNotification);

  const [range, setRange] = useState<RangeKey>('24h');
  const [tab, setTab] = useState<TabKey>('realtime');
  const [search, setSearch] = useState('');
  const [model, setModel] = useState('');
  const [provider, setProvider] = useState('');
  const [source, setSource] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'success' | 'failed'>('all');
  const [autoMs, setAutoMs] = useState(5_000);
  const [loading, setLoading] = useState(false);
  const [events, setEvents] = useState<UsageEvent[]>([]);
  const [summary, setSummary] = useState<UsageSummary | null>(null);
  const [accounts, setAccounts] = useState<UsageAccountStat[]>([]);
  const [apiKeyStats, setApiKeyStats] = useState<UsageAPIKeyStat[]>([]);
  const [apiKeyLabels, setApiKeyLabels] = useState<Record<string, string>>({});
  const [filterOptions, setFilterOptions] = useState<UsageFilterOptions | null>(null);
  const [prices, setPrices] = useState<ModelPrice[]>([]);
  const [aliases, setAliases] = useState<ModelPriceAlias[]>([]);
  const [unpriced, setUnpriced] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [statsEnabledHint, setStatsEnabledHint] = useState<boolean | null>(null);

  const [priceModel, setPriceModel] = useState('');
  const [pricePrompt, setPricePrompt] = useState('');
  const [priceCompletion, setPriceCompletion] = useState('');
  const [priceCacheRead, setPriceCacheRead] = useState('');
  const [priceCacheWrite, setPriceCacheWrite] = useState('');
  const [aliasFrom, setAliasFrom] = useState('');
  const [aliasTo, setAliasTo] = useState('');
  const [priceSearch, setPriceSearch] = useState('');
  const [priceListFilter, setPriceListFilter] = useState<PriceListFilter>('all');

  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<PriceSyncResult | null>(null);
  const [candidatePicks, setCandidatePicks] = useState<Record<string, string>>({});
  const [overrideManual, setOverrideManual] = useState(false);

  // Build query at call time so refresh uses a fresh upper time bound.
  // Do not depend on filterOptions here — loading them would recreate this callback and loop.
  const buildQuery = useCallback((): UsageQuery => {
    const base = rangeToMs(range);
    const sourcePick = source.trim();
    const apiKeyPick = apiKey.trim();
    return {
      ...base,
      search: search.trim() || undefined,
      models: model ? [model] : undefined,
      providers: provider ? [provider] : undefined,
      sources: sourcePick ? [sourcePick] : undefined,
      api_keys: apiKeyPick ? [apiKeyPick] : undefined,
      failed_only: statusFilter === 'failed' || undefined,
      success_only: statusFilter === 'success' || undefined,
      limit: 200,
    };
  }, [range, search, model, provider, source, apiKey, statusFilter]);

  const loadCore = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const query = buildQuery();
      const [eventsRes, summaryRes, filtersRes] = await Promise.all([
        usageEventsApi.listEvents(query),
        usageEventsApi.getSummary(query),
        usageEventsApi.getFilterOptions(query),
      ]);
      setEvents(eventsRes.events || []);
      setSummary(summaryRes.summary || null);
      setStatsEnabledHint(summaryRes.usage_statistics_enabled ?? null);
      setFilterOptions(filtersRes);
    } catch (err) {
      setError(getErrorMessage(err));
      setEvents([]);
      setSummary(null);
    } finally {
      setLoading(false);
    }
  }, [buildQuery]);

  const loadAccounts = useCallback(async () => {
    try {
      const res = await usageEventsApi.getAccountStats(buildQuery());
      setAccounts(res.accounts || []);
    } catch (err) {
      showNotification(getErrorMessage(err), 'error');
    }
  }, [buildQuery, showNotification]);

  const loadApiKeyStats = useCallback(async () => {
    try {
      const res = await usageEventsApi.getAPIKeyStats(buildQuery());
      setApiKeyStats(res.api_keys || []);
    } catch (err) {
      showNotification(getErrorMessage(err), 'error');
    }
  }, [buildQuery, showNotification]);

  const loadApiKeyLabels = useCallback(async () => {
    try {
      const yaml = await configFileApi.fetchConfigYaml();
      setApiKeyLabels(parseApiKeyLabelMap(yaml));
    } catch {
      // Labels are optional; keep prior map on failure.
    }
  }, []);

  const applyPricesResponse = useCallback(
    (res: { prices?: ModelPrice[]; aliases?: ModelPriceAlias[]; unpriced_models?: string[] }) => {
      setPrices(res.prices || []);
      setAliases(res.aliases || []);
      setUnpriced(res.unpriced_models || []);
    },
    []
  );

  const loadPrices = useCallback(async () => {
    try {
      const res = await usageEventsApi.getModelPrices();
      applyPricesResponse(res);
    } catch (err) {
      showNotification(getErrorMessage(err), 'error');
    }
  }, [applyPricesResponse, showNotification]);

  const refresh = useCallback(async () => {
    await loadCore();
    void loadApiKeyLabels();
    if (tab === 'accounts') await loadAccounts();
    if (tab === 'api_keys') await loadApiKeyStats();
    if (tab === 'prices') await loadPrices();
  }, [loadCore, loadAccounts, loadApiKeyStats, loadApiKeyLabels, loadPrices, tab]);

  useHeaderRefresh(refresh);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!autoMs) return;
    const id = window.setInterval(() => {
      void loadCore();
      if (tab === 'accounts') void loadAccounts();
      if (tab === 'api_keys') void loadApiKeyStats();
    }, autoMs);
    return () => window.clearInterval(id);
  }, [autoMs, loadCore, loadAccounts, loadApiKeyStats, tab]);

  const clearFilters = () => {
    setSearch('');
    setModel('');
    setProvider('');
    setSource('');
    setApiKey('');
    setStatusFilter('all');
    setRange('24h');
  };

  const enableStatistics = async () => {
    try {
      await apiClient.put('/usage-statistics-enabled', { value: true });
      setStatsEnabledHint(true);
      showNotification(t('monitoring.stats_enabled'), 'success');
      await refresh();
    } catch (err) {
      showNotification(getErrorMessage(err), 'error');
    }
  };

  const savePrice = async (asManual = true) => {
    const modelName = priceModel.trim();
    if (!modelName) return;
    try {
      await usageEventsApi.putModelPrices([
        {
          model: modelName,
          prompt_per_1m: Number(pricePrompt) || 0,
          completion_per_1m: Number(priceCompletion) || 0,
          cache_read_per_1m: Number(priceCacheRead) || 0,
          cache_creation_per_1m: Number(priceCacheWrite) || 0,
          source: asManual ? 'manual' : 'override',
        },
      ]);
      showNotification(t('monitoring.price_saved'), 'success');
      setPriceModel('');
      setPricePrompt('');
      setPriceCompletion('');
      setPriceCacheRead('');
      setPriceCacheWrite('');
      await loadPrices();
      await loadCore();
    } catch (err) {
      showNotification(getErrorMessage(err), 'error');
    }
  };

  const startEditPrice = (p: ModelPrice) => {
    setPriceModel(p.model);
    setPricePrompt(String(p.prompt_per_1m ?? ''));
    setPriceCompletion(String(p.completion_per_1m ?? ''));
    setPriceCacheRead(p.cache_read_per_1m ? String(p.cache_read_per_1m) : '');
    setPriceCacheWrite(p.cache_creation_per_1m ? String(p.cache_creation_per_1m) : '');
    setPriceListFilter('all');
  };

  const saveAlias = async () => {
    const from = aliasFrom.trim();
    const to = aliasTo.trim();
    if (!from || !to) return;
    try {
      await usageEventsApi.putModelPriceAliases([{ alias: from, target_model: to }]);
      showNotification(t('monitoring.alias_saved'), 'success');
      setAliasFrom('');
      setAliasTo('');
      await loadPrices();
      await loadCore();
    } catch (err) {
      showNotification(getErrorMessage(err), 'error');
    }
  };

  const deleteAlias = async (alias: string) => {
    try {
      await usageEventsApi.deleteModelPriceAlias(alias);
      await loadPrices();
      await loadCore();
    } catch (err) {
      showNotification(getErrorMessage(err), 'error');
    }
  };

  const deletePrice = async (modelName: string) => {
    try {
      await usageEventsApi.deleteModelPrice(modelName);
      await loadPrices();
      await loadCore();
    } catch (err) {
      showNotification(getErrorMessage(err), 'error');
    }
  };

  const syncPrices = async () => {
    setSyncing(true);
    try {
      const result = await usageEventsApi.syncModelPrices({
        override_manual: overrideManual,
        apply_matched: true,
      });
      setSyncResult(result);
      applyPricesResponse({
        prices: result.prices,
        aliases: result.aliases,
        unpriced_models: result.unpriced_models,
      });
      const picks: Record<string, string> = {};
      for (const set of result.candidates || []) {
        if (set.candidates?.[0]) {
          picks[set.model] = set.candidates[0].source_model_id;
        }
      }
      setCandidatePicks(picks);
      showNotification(
        t('monitoring.sync_success', {
          imported: result.imported,
          candidates: result.candidates?.length ?? 0,
          unmatched: result.unmatched?.length ?? 0,
        }),
        'success'
      );
      await loadCore();
    } catch (err) {
      showNotification(getErrorMessage(err), 'error');
    } finally {
      setSyncing(false);
    }
  };

  const applyCandidate = async (set: PriceSyncCandidateSet) => {
    const pickId = candidatePicks[set.model];
    const cand = set.candidates.find((c) => c.source_model_id === pickId) || set.candidates[0];
    if (!cand) return;
    try {
      const price: ModelPrice = {
        model: set.model,
        prompt_per_1m: cand.price.prompt_per_1m,
        completion_per_1m: cand.price.completion_per_1m,
        cache_per_1m: cand.price.cache_per_1m,
        cache_read_per_1m: cand.price.cache_read_per_1m,
        cache_creation_per_1m: cand.price.cache_creation_per_1m,
        source: cand.price.source || 'sync',
      };
      await usageEventsApi.putModelPrices([price]);
      showNotification(t('monitoring.candidate_applied', { model: set.model }), 'success');
      setSyncResult((prev) =>
        prev
          ? {
              ...prev,
              candidates: (prev.candidates || []).filter((c) => c.model !== set.model),
            }
          : prev
      );
      await loadPrices();
      await loadCore();
    } catch (err) {
      showNotification(getErrorMessage(err), 'error');
    }
  };

  const statsOff = statsEnabledHint === false;

  // The recorded input_tokens is the full prompt; for OpenAI-compatible providers
  // it already includes cache-read tokens. Show the net (uncached) input so the
  // Input / Cache read / Cache write / Output cards don't overlap. When input is
  // already net (Anthropic-style, input < cache read) there is nothing to subtract.
  const netInputTokens = summary
    ? summary.input_tokens >= summary.cache_read_tokens
      ? summary.input_tokens - summary.cache_read_tokens
      : summary.input_tokens
    : undefined;

  const rangeOptions: Array<[RangeKey, string]> = [
    ['24h', t('monitoring.range_24h')],
    ['7d', '7d'],
    ['14d', '14d'],
    ['30d', '30d'],
    ['all', t('monitoring.range_all')],
  ];

  const providerOptions = useMemo(
    () => [
      { value: '', label: t('monitoring.filter_providers') },
      ...(filterOptions?.providers || []).map((p) => ({ value: p, label: p })),
    ],
    [filterOptions?.providers, t]
  );

  const modelOptions = useMemo(
    () => [
      { value: '', label: t('monitoring.filter_models') },
      ...(filterOptions?.models || []).map((m) => ({ value: m, label: m })),
    ],
    [filterOptions?.models, t]
  );

  const statusOptions = useMemo(
    () => [
      { value: 'all', label: t('monitoring.filter_statuses') },
      { value: 'success', label: t('monitoring.status_success') },
      { value: 'failed', label: t('monitoring.status_failed') },
    ],
    [t]
  );

  const sourceOptions = useMemo(() => {
    // Distinct emails / API keys only — skip auth_index hashes (already listed under Auth elsewhere).
    const values = Array.from(new Set((filterOptions?.sources || []).filter(Boolean))).sort(
      (a, b) => a.localeCompare(b)
    );
    return [
      { value: '', label: t('monitoring.filter_sources') },
      ...values.map((s) => ({ value: s, label: s })),
    ];
  }, [filterOptions?.sources, t]);

  const formatApiKeyDisplay = useCallback(
    (key?: string | null, hash?: string | null) => {
      const raw = (key || '').trim();
      if (raw) {
        const label = apiKeyLabels[raw];
        if (label) return label;
        return raw;
      }
      return (hash || '').trim() || '—';
    },
    [apiKeyLabels]
  );

  const apiKeyOptions = useMemo(() => {
    const values = Array.from(new Set((filterOptions?.api_keys || []).filter(Boolean))).sort(
      (a, b) => {
        const la = formatApiKeyDisplay(a).toLowerCase();
        const lb = formatApiKeyDisplay(b).toLowerCase();
        return la.localeCompare(lb) || a.localeCompare(b);
      }
    );
    return [
      { value: '', label: t('monitoring.filter_api_keys') },
      ...values.map((k) => ({
        value: k,
        // Prefer config label when set; otherwise the raw key.
        label: apiKeyLabels[k] || k,
      })),
    ];
  }, [filterOptions?.api_keys, apiKeyLabels, formatApiKeyDisplay, t]);

  const autoOptions = useMemo(
    () =>
      AUTO_OPTIONS.map((opt) => ({
        value: opt.value,
        label: `${t('monitoring.auto_prefix')} ${opt.label}`,
      })),
    [t]
  );

  const tabs: Array<[TabKey, string, number | null]> = [
    ['realtime', t('monitoring.tab_realtime'), events.length],
    ['accounts', t('monitoring.tab_accounts'), null],
    ['api_keys', t('monitoring.tab_api_keys'), null],
    ['prices', t('monitoring.tab_prices'), null],
  ];

  const priceFilterCounts = useMemo(() => {
    const manual = prices.filter((p) => isManualSource(p.source)).length;
    const synced = prices.filter((p) => !isManualSource(p.source)).length;
    return {
      all: prices.length,
      manual,
      synced,
      unpriced: unpriced.length,
    };
  }, [prices, unpriced]);

  const visiblePrices = useMemo(() => {
    const q = priceSearch.trim().toLowerCase();
    let list = prices;
    if (priceListFilter === 'manual') {
      list = list.filter((p) => isManualSource(p.source));
    } else if (priceListFilter === 'synced') {
      list = list.filter((p) => !isManualSource(p.source));
    } else if (priceListFilter === 'unpriced') {
      // Show unpriced as synthetic rows for selection into the manual form.
      return [];
    }
    if (!q) return list;
    return list.filter(
      (p) => p.model.toLowerCase().includes(q) || (p.source || '').toLowerCase().includes(q)
    );
  }, [prices, priceSearch, priceListFilter]);

  const priceChipFilters: Array<[PriceListFilter, string]> = [
    ['all', t('monitoring.price_filter_all')],
    ['synced', t('monitoring.price_filter_synced')],
    ['manual', t('monitoring.price_filter_manual')],
    ['unpriced', t('monitoring.price_filter_unpriced')],
  ];

  return (
    <div className={styles.container}>
      <div className={styles.filterSection}>
        <div className={styles.filterPrimary}>
          <div className={styles.rangeGroup} role="group" aria-label={t('monitoring.range_24h')}>
            {rangeOptions.map(([key, label]) => (
              <button
                key={key}
                type="button"
                className={`${styles.rangeChip} ${range === key ? styles.rangeChipActive : ''}`}
                onClick={() => setRange(key)}
              >
                {label}
              </button>
            ))}
          </div>

          <div className={styles.searchWrap}>
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('monitoring.search_placeholder')}
              aria-label={t('monitoring.search_placeholder')}
            />
          </div>

          <div className={styles.filterActions}>
            <Button variant="secondary" size="sm" onClick={() => void refresh()} disabled={loading}>
              {t('common.refresh')}
            </Button>
            <Button variant="ghost" size="sm" onClick={clearFilters}>
              <IconX size={16} />
              {t('monitoring.clear')}
            </Button>
            <Select
              className={styles.autoSelect}
              value={String(autoMs)}
              options={autoOptions}
              onChange={(v) => setAutoMs(Number(v))}
              ariaLabel={t('monitoring.auto_refresh')}
              size="sm"
            />
          </div>
        </div>

        <div className={styles.filterSecondary}>
          <Select
            className={styles.filterSelect}
            value={source}
            options={sourceOptions}
            onChange={setSource}
            ariaLabel={t('monitoring.filter_sources')}
            size="sm"
            fullWidth
          />
          <Select
            className={styles.filterSelect}
            value={apiKey}
            options={apiKeyOptions}
            onChange={setApiKey}
            ariaLabel={t('monitoring.filter_api_keys')}
            size="sm"
            fullWidth
          />
          <Select
            className={styles.filterSelect}
            value={provider}
            options={providerOptions}
            onChange={setProvider}
            ariaLabel={t('monitoring.filter_providers')}
            size="sm"
            fullWidth
          />
          <Select
            className={styles.filterSelect}
            value={model}
            options={modelOptions}
            onChange={setModel}
            ariaLabel={t('monitoring.filter_models')}
            size="sm"
            fullWidth
          />
          <Select
            className={styles.filterSelect}
            value={statusFilter}
            options={statusOptions}
            onChange={(v) => setStatusFilter(v as 'all' | 'success' | 'failed')}
            ariaLabel={t('monitoring.filter_statuses')}
            size="sm"
            fullWidth
          />
        </div>
      </div>

      {statsOff ? (
        <div className={styles.banner}>
          <span>{t('monitoring.stats_disabled_hint')}</span>
          <Button size="sm" onClick={() => void enableStatistics()}>
            {t('monitoring.enable_stats')}
          </Button>
        </div>
      ) : null}

      {error ? (
        <div className={`${styles.banner} ${styles.bannerError}`}>
          <span>{error}</span>
          <Button variant="secondary" size="sm" onClick={() => void refresh()}>
            {t('common.retry')}
          </Button>
        </div>
      ) : null}

      <div className={styles.summaryGrid}>
        <div className={styles.summaryCard}>
          <div className={styles.summaryLabel}>{t('monitoring.card_calls')}</div>
          <div className={styles.summaryValue}>{formatNumber(summary?.total_calls)}</div>
        </div>
        <div className={styles.summaryCard}>
          <div className={styles.summaryLabel}>{t('monitoring.card_success')}</div>
          <div className={`${styles.summaryValue} ${styles.summaryValueSuccess}`}>
            {summary ? `${(summary.success_rate * 100).toFixed(1)}%` : '—'}
          </div>
        </div>
        <div className={styles.summaryCard}>
          <div className={styles.summaryLabel}>{t('monitoring.card_failed')}</div>
          <div className={`${styles.summaryValue} ${styles.summaryValueDanger}`}>
            {formatNumber(summary?.failure_calls)}
          </div>
        </div>
        <div className={styles.summaryCard}>
          <div className={styles.summaryLabel}>{t('monitoring.card_cost')}</div>
          <div className={styles.summaryValue}>{formatUsd(summary?.estimated_cost)}</div>
        </div>
        <div className={styles.summaryCard}>
          <div className={styles.summaryLabel}>{t('monitoring.card_tokens')}</div>
          <div className={styles.summaryValue}>{formatNumber(summary?.total_tokens)}</div>
        </div>
        <div className={styles.summaryCard} title={t('monitoring.card_input_hint')}>
          <div className={styles.summaryLabel}>{t('monitoring.card_input')}</div>
          <div className={styles.summaryValue}>{formatNumber(netInputTokens)}</div>
        </div>
        <div className={styles.summaryCard}>
          <div className={styles.summaryLabel}>{t('monitoring.card_output')}</div>
          <div className={styles.summaryValue}>{formatNumber(summary?.output_tokens)}</div>
        </div>
        <div className={styles.summaryCard} title={t('monitoring.card_cache_read_hint')}>
          <div className={styles.summaryLabel}>{t('monitoring.card_cache_read')}</div>
          <div className={styles.summaryValue}>{formatNumber(summary?.cache_read_tokens)}</div>
        </div>
        <div className={styles.summaryCard}>
          <div className={styles.summaryLabel}>{t('monitoring.card_cache_write')}</div>
          <div className={styles.summaryValue}>{formatNumber(summary?.cache_creation_tokens)}</div>
        </div>
      </div>

      <div className={styles.tabBar} role="tablist" aria-label={t('nav.monitoring')}>
        {tabs.map(([key, label, count]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            className={`${styles.tabItem} ${tab === key ? styles.tabActive : ''}`}
            onClick={() => {
              setTab(key);
              if (key === 'accounts') void loadAccounts();
              if (key === 'api_keys') void loadApiKeyStats();
              if (key === 'prices') void loadPrices();
            }}
          >
            {label}
            {count !== null ? <span className={styles.tabCount}>{count}</span> : null}
          </button>
        ))}
      </div>

      {tab === 'realtime' ? (
        <div className={styles.tableSection}>
          {events.length === 0 ? (
            <div className={styles.emptyWrap}>
              <EmptyState
                title={t('monitoring.empty_events')}
                description={t('monitoring.empty_events_hint')}
              />
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('monitoring.col_source')}</TableHead>
                  <TableHead>{t('monitoring.col_api_key')}</TableHead>
                  <TableHead>{t('monitoring.col_model')}</TableHead>
                  <TableHead>{t('monitoring.col_effort')}</TableHead>
                  <TableHead>{t('monitoring.col_status')}</TableHead>
                  <TableHead alignRight>{t('monitoring.col_ttft')}</TableHead>
                  <TableHead alignRight>{t('monitoring.col_elapsed')}</TableHead>
                  <TableHead>{t('monitoring.col_time')}</TableHead>
                  <TableHead alignRight>{t('monitoring.col_usage')}</TableHead>
                  <TableHead alignRight>{t('monitoring.col_cost')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {events.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell>
                      <div className={styles.cellStack}>
                        <span className={`${styles.cellPrimary} ${styles.mono}`}>
                          {e.source || e.auth_index || '—'}
                        </span>
                        {e.provider ? (
                          <span className={styles.cellSecondary}>{e.provider}</span>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className={styles.cellStack}>
                        <span className={styles.mono}>
                          {formatApiKeyDisplay(e.api_key, e.api_key_hash)}
                        </span>
                        {e.api_key && apiKeyLabels[e.api_key] ? (
                          <span className={`${styles.cellSecondary} ${styles.mono}`} title={e.api_key}>
                            {e.api_key}
                          </span>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className={styles.mono}>{e.model || e.alias || '—'}</span>
                    </TableCell>
                    <TableCell>{e.reasoning_effort || '—'}</TableCell>
                    <TableCell>
                      <div className={styles.cellStack}>
                        {e.failed ? (
                          <span className={styles.statusFail}>
                            {e.fail_status_code || t('monitoring.status_failed')}
                          </span>
                        ) : (
                          <span className={styles.statusOk}>{t('monitoring.status_success')}</span>
                        )}
                        {e.fail_summary ? (
                          <span className={styles.cellSecondary} title={e.fail_summary}>
                            {e.fail_summary.slice(0, 64)}
                          </span>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell alignRight>
                      <span className={styles.num}>{formatDuration(e.ttft_ms)}</span>
                    </TableCell>
                    <TableCell alignRight>
                      <span className={styles.num}>{formatDuration(e.latency_ms)}</span>
                    </TableCell>
                    <TableCell>
                      <span className={styles.cellSecondary}>{formatTime(e.timestamp_ms)}</span>
                    </TableCell>
                    <TableCell alignRight>
                      <div className={styles.cellStack} style={{ alignItems: 'flex-end' }}>
                        <span className={styles.num}>{formatNumber(e.total_tokens)}</span>
                        <span className={styles.cellSecondary}>{formatTokensCompact(e)}</span>
                      </div>
                    </TableCell>
                    <TableCell alignRight>
                      <span className={styles.num}>{formatUsd(e.estimated_cost)}</span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      ) : null}

      {tab === 'accounts' ? (
        <div className={styles.tableSection}>
          {accounts.length === 0 ? (
            <div className={styles.emptyWrap}>
              <EmptyState title={t('monitoring.empty_accounts')} />
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('monitoring.col_source')}</TableHead>
                  <TableHead>{t('monitoring.col_auth')}</TableHead>
                  <TableHead>{t('monitoring.col_provider')}</TableHead>
                  <TableHead alignRight>{t('monitoring.card_calls')}</TableHead>
                  <TableHead alignRight>{t('monitoring.card_success')}</TableHead>
                  <TableHead alignRight>{t('monitoring.card_tokens')}</TableHead>
                  <TableHead alignRight>{t('monitoring.card_cost')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {accounts.map((a, idx) => (
                  <TableRow key={`${a.auth_index}-${a.source_hash}-${idx}`}>
                    <TableCell>
                      <span className={styles.mono}>{a.source || '—'}</span>
                    </TableCell>
                    <TableCell>
                      <span className={styles.mono}>{a.auth_index || '—'}</span>
                    </TableCell>
                    <TableCell>{a.provider || '—'}</TableCell>
                    <TableCell alignRight className={styles.num}>
                      {formatNumber(a.total_calls)}
                    </TableCell>
                    <TableCell alignRight className={styles.num}>
                      {a.total_calls
                        ? `${((a.success_calls / a.total_calls) * 100).toFixed(1)}%`
                        : '—'}
                    </TableCell>
                    <TableCell alignRight className={styles.num}>
                      {formatNumber(a.total_tokens)}
                    </TableCell>
                    <TableCell alignRight className={styles.num}>
                      {formatUsd(a.estimated_cost)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      ) : null}

      {tab === 'api_keys' ? (
        <div className={styles.tableSection}>
          {apiKeyStats.length === 0 ? (
            <div className={styles.emptyWrap}>
              <EmptyState title={t('monitoring.empty_api_keys')} />
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('monitoring.col_api_key_label')}</TableHead>
                  <TableHead>{t('monitoring.col_api_key')}</TableHead>
                  <TableHead alignRight>{t('monitoring.card_calls')}</TableHead>
                  <TableHead alignRight>{t('monitoring.card_success')}</TableHead>
                  <TableHead alignRight>{t('monitoring.card_failed')}</TableHead>
                  <TableHead alignRight>{t('monitoring.card_tokens')}</TableHead>
                  <TableHead alignRight>{t('monitoring.card_cost')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {apiKeyStats.map((row, idx) => {
                  const key = row.api_key || '';
                  const label = key ? apiKeyLabels[key] : '';
                  return (
                    <TableRow key={`${key}-${row.api_key_hash || ''}-${idx}`}>
                      <TableCell>
                        <span className={label ? undefined : styles.cellSecondary}>
                          {label || '—'}
                        </span>
                      </TableCell>
                      <TableCell>
                        <span className={styles.mono} title={key || row.api_key_hash || undefined}>
                          {key || row.api_key_hash || '—'}
                        </span>
                      </TableCell>
                      <TableCell alignRight className={styles.num}>
                        {formatNumber(row.total_calls)}
                      </TableCell>
                      <TableCell alignRight className={styles.num}>
                        {row.total_calls
                          ? `${((row.success_calls / row.total_calls) * 100).toFixed(1)}%`
                          : '—'}
                      </TableCell>
                      <TableCell alignRight className={styles.num}>
                        {formatNumber(row.failure_calls)}
                      </TableCell>
                      <TableCell alignRight className={styles.num}>
                        {formatNumber(row.total_tokens)}
                      </TableCell>
                      <TableCell alignRight className={styles.num}>
                        {formatUsd(row.estimated_cost)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </div>
      ) : null}

      {tab === 'prices' ? (
        <div className={styles.pricesLayout}>
          {/* 1. Action bar: title + sync controls */}
          <section className={styles.pricesActionBar} aria-label={t('monitoring.prices_editor')}>
            <div className={styles.pricesTitleGroup}>
              <h3 className={styles.pricesTitle}>{t('monitoring.prices_editor')}</h3>
              <p className={styles.pricesHint}>{t('monitoring.prices_hint')}</p>
            </div>
            <div className={styles.pricesActionGroup}>
              <label className={styles.overrideRow}>
                <input
                  type="checkbox"
                  checked={overrideManual}
                  onChange={(e) => setOverrideManual(e.target.checked)}
                />
                {t('monitoring.override_manual')}
              </label>
              <Button size="sm" loading={syncing} onClick={() => void syncPrices()}>
                {t('monitoring.sync_prices')}
              </Button>
            </div>
          </section>

          {syncResult ? (
            <div className={styles.syncMeta}>
              <span className={styles.metaPill}>
                {t('monitoring.sync_imported')}: {syncResult.imported}
              </span>
              <span className={styles.metaPill}>
                {t('monitoring.sync_candidates')}: {syncResult.candidates?.length ?? 0}
              </span>
              <span className={styles.metaPill}>
                {t('monitoring.sync_unmatched')}: {syncResult.unmatched?.length ?? 0}
              </span>
              {(syncResult.skipped_manual ?? 0) > 0 ? (
                <span className={styles.metaPill}>
                  {t('monitoring.sync_skipped_manual')}: {syncResult.skipped_manual}
                </span>
              ) : null}
              {(syncResult.sources || []).length > 0 ? (
                <span className={styles.metaPill}>
                  {t('monitoring.sync_sources')}: {(syncResult.sources || []).join(', ')}
                </span>
              ) : null}
            </div>
          ) : null}

          {/* 2. Mapping candidates when needed */}
          {(syncResult?.candidates?.length ?? 0) > 0 ? (
            <section className={styles.candidatesPanel}>
              <h4 className={styles.panelHeading}>{t('monitoring.candidates_title')}</h4>
              <p className={styles.muted}>{t('monitoring.candidates_hint')}</p>
              <div className={styles.candidatesList}>
                {(syncResult?.candidates || []).map((set) => {
                  const options = set.candidates.map((c) => ({
                    value: c.source_model_id,
                    label: `${c.source_model_id} · ${Math.round(c.score * 100)}% · $${formatRate(c.price.prompt_per_1m)} / $${formatRate(c.price.completion_per_1m)}`,
                  }));
                  return (
                    <div key={set.model} className={styles.candidateBlock}>
                      <span className={styles.candidateModel} title={set.model}>
                        {set.model}
                      </span>
                      <Select
                        className={styles.candidateSelect}
                        value={candidatePicks[set.model] || options[0]?.value || ''}
                        options={options}
                        onChange={(v) => setCandidatePicks((prev) => ({ ...prev, [set.model]: v }))}
                        size="sm"
                        fullWidth
                        ariaLabel={t('monitoring.candidates_title')}
                      />
                      <Button size="sm" onClick={() => void applyCandidate(set)}>
                        {t('monitoring.apply_candidate')}
                      </Button>
                    </div>
                  );
                })}
              </div>
            </section>
          ) : null}

          {/* 3. Unified price list with search + chips */}
          <section className={styles.pricePanel}>
            <div className={styles.pricePanelToolbar}>
              <div className={styles.priceSearch}>
                <Input
                  value={priceSearch}
                  onChange={(e) => setPriceSearch(e.target.value)}
                  placeholder={t('monitoring.price_search_placeholder')}
                  aria-label={t('monitoring.price_search_placeholder')}
                />
              </div>
              <div className={styles.priceFilterChips}>
                {priceChipFilters.map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    className={`${styles.filterChip} ${
                      priceListFilter === key ? styles.filterChipActive : ''
                    }`}
                    onClick={() => setPriceListFilter(key)}
                  >
                    <span>{label}</span>
                    <strong>{priceFilterCounts[key]}</strong>
                  </button>
                ))}
              </div>
            </div>

            {priceListFilter === 'unpriced' ? (
              unpriced.length === 0 ? (
                <div className={styles.emptyWrap}>
                  <EmptyState title={t('monitoring.empty_unpriced')} />
                </div>
              ) : (
                <div className={styles.unpricedRow}>
                  {unpriced.map((m) => (
                    <button
                      key={m}
                      type="button"
                      className={styles.unpricedChip}
                      onClick={() => {
                        setPriceModel(m);
                        setAliasFrom(m);
                        setPriceListFilter('all');
                      }}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              )
            ) : visiblePrices.length === 0 ? (
              <div className={styles.emptyWrap}>
                <EmptyState
                  title={t('monitoring.empty_prices')}
                  description={t('monitoring.empty_prices_hint')}
                />
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('monitoring.col_model')}</TableHead>
                    <TableHead alignRight>{t('monitoring.price_prompt')}</TableHead>
                    <TableHead alignRight>{t('monitoring.price_completion')}</TableHead>
                    <TableHead alignRight>{t('monitoring.price_cache_read')}</TableHead>
                    <TableHead alignRight>{t('monitoring.price_cache_write')}</TableHead>
                    <TableHead>{t('monitoring.price_source')}</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visiblePrices.map((p) => (
                    <TableRow key={p.model}>
                      <TableCell>
                        <span className={styles.mono}>{p.model}</span>
                      </TableCell>
                      <TableCell alignRight className={styles.num}>
                        {formatRate(p.prompt_per_1m)}
                      </TableCell>
                      <TableCell alignRight className={styles.num}>
                        {formatRate(p.completion_per_1m)}
                      </TableCell>
                      <TableCell alignRight className={styles.num}>
                        {p.cache_read_per_1m ? formatRate(p.cache_read_per_1m) : '—'}
                      </TableCell>
                      <TableCell alignRight className={styles.num}>
                        {p.cache_creation_per_1m ? formatRate(p.cache_creation_per_1m) : '—'}
                      </TableCell>
                      <TableCell>
                        <span className={styles.cellSecondary}>{p.source || 'manual'}</span>
                      </TableCell>
                      <TableCell>
                        <div className={styles.formActions}>
                          <Button variant="ghost" size="sm" onClick={() => startEditPrice(p)}>
                            {t('common.edit')}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => void deletePrice(p.model)}
                          >
                            {t('common.delete')}
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </section>

          {/* 4. Secondary: manual override + alias side by side */}
          <div className={styles.secondaryEditors}>
            <section className={styles.editorBlock}>
              <h4 className={styles.panelHeading}>{t('monitoring.manual_price_title')}</h4>
              <p className={styles.muted}>{t('monitoring.manual_price_hint')}</p>
              <div className={styles.formGrid}>
                <Input
                  label={t('monitoring.col_model')}
                  value={priceModel}
                  onChange={(e) => setPriceModel(e.target.value)}
                  placeholder="gpt-5.5"
                />
                <Input
                  label={t('monitoring.price_prompt')}
                  value={pricePrompt}
                  onChange={(e) => setPricePrompt(e.target.value)}
                  placeholder="1.25"
                />
                <Input
                  label={t('monitoring.price_completion')}
                  value={priceCompletion}
                  onChange={(e) => setPriceCompletion(e.target.value)}
                  placeholder="10"
                />
                <Input
                  label={t('monitoring.price_cache_read')}
                  value={priceCacheRead}
                  onChange={(e) => setPriceCacheRead(e.target.value)}
                  placeholder="0.125"
                />
                <Input
                  label={t('monitoring.price_cache_write')}
                  value={priceCacheWrite}
                  onChange={(e) => setPriceCacheWrite(e.target.value)}
                  placeholder="1.5625"
                />
                <div className={styles.formActions}>
                  <Button size="sm" onClick={() => void savePrice(true)}>
                    {t('monitoring.save_price')}
                  </Button>
                </div>
              </div>
            </section>

            <section className={styles.editorBlock}>
              <h4 className={styles.panelHeading}>{t('monitoring.alias_editor')}</h4>
              <p className={styles.muted}>{t('monitoring.alias_hint')}</p>
              <div className={styles.formGrid}>
                <Input
                  label={t('monitoring.alias_from')}
                  value={aliasFrom}
                  onChange={(e) => setAliasFrom(e.target.value)}
                  placeholder="brand-gpt-5.5"
                />
                <Input
                  label={t('monitoring.alias_to')}
                  value={aliasTo}
                  onChange={(e) => setAliasTo(e.target.value)}
                  placeholder="gpt-5.5"
                />
                <div className={styles.formActions}>
                  <Button size="sm" onClick={() => void saveAlias()}>
                    {t('monitoring.save_alias')}
                  </Button>
                </div>
              </div>

              {aliases.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('monitoring.alias_from')}</TableHead>
                      <TableHead>{t('monitoring.alias_to')}</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {aliases.map((a) => (
                      <TableRow key={a.alias}>
                        <TableCell>
                          <span className={styles.mono}>{a.alias}</span>
                        </TableCell>
                        <TableCell>
                          <span className={styles.mono}>{a.target_model}</span>
                        </TableCell>
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => void deleteAlias(a.alias)}
                          >
                            {t('common.delete')}
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : null}
            </section>
          </div>
        </div>
      ) : null}
    </div>
  );
}
