import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Modal } from '@/components/ui/Modal';
import {
  monitoringBounds,
  localDateTime,
  parseLocalDateTime,
  type MonitoringRange,
  type PresetRange,
} from './monitoringRange';
import { useMonitoringData, type MonitoringTab } from './useMonitoringData';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { SearchableSelect } from '@/components/ui/SearchableSelect';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/Table';
import { IconX } from '@/components/ui/icons';
import { ProviderStatusBar } from '@/components/providers/ProviderStatusBar';
import statusBarStyles from '@/features/providers/components/providerStatusBar.module.scss';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import {
  usageEventsApi,
  type ModelPrice,
  type ModelPriceAlias,
  type PriceSyncCandidateSet,
  type PriceSyncResult,
  type UsageEvent,
  type UsageQuery,
} from '@/services/api/usageEvents';
import { configFileApi } from '@/services/api/configFile';
import { apiClient } from '@/services/api/client';
import { parseApiKeyEntries } from '@/hooks/useVisualConfig';
import { useNotificationStore } from '@/stores';
import { getErrorMessage } from '@/utils/helpers';
import { isScalar, isSeq, parseDocument } from 'yaml';
import { statusBarDataFromRecentRequests, type StatusBarData } from '@/utils/recentRequests';
import {
  accountStatusKey,
  calculateOutputTps,
  formatCompactTokens,
  formatTimestampParts,
  formatVisibleTokenBreakdown,
  getAccountStatusKeyForEvent,
  getEffectiveServiceTier,
  getServiceTierTitle,
  getTokenDetailLines,
} from './monitoringMetrics';
import styles from './MonitoringPage.module.scss';

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

const numberFormatters = {
  0: new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }),
  4: new Intl.NumberFormat(undefined, { maximumFractionDigits: 4, minimumFractionDigits: 2 }),
};
const dateTimeFormatter = new Intl.DateTimeFormat(undefined, {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

const formatNumber = (value: number | undefined | null, digits = 0) => {
  if (value === undefined || value === null || !Number.isFinite(value)) return '—';
  const formatter = digits === 4 ? numberFormatters[4] : numberFormatters[0];
  return formatter.format(value);
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
  return dateTimeFormatter.format(ms);
};

const USAGE_TOOLTIP_VIEWPORT_MARGIN = 8;
const USAGE_TOOLTIP_OFFSET = 8;
const USAGE_TOOLTIP_WIDTH = 220;
const USAGE_TOOLTIP_Z_INDEX = 2010;

const clampValue = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const resolveUsageTooltipStyle = (anchor: HTMLElement): CSSProperties => {
  const rect = anchor.getBoundingClientRect();
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const width = Math.min(
    USAGE_TOOLTIP_WIDTH,
    Math.max(0, viewportWidth - USAGE_TOOLTIP_VIEWPORT_MARGIN * 2)
  );
  const left = clampValue(
    rect.right - width,
    USAGE_TOOLTIP_VIEWPORT_MARGIN,
    Math.max(USAGE_TOOLTIP_VIEWPORT_MARGIN, viewportWidth - width - USAGE_TOOLTIP_VIEWPORT_MARGIN)
  );
  const spaceAbove = rect.top - USAGE_TOOLTIP_VIEWPORT_MARGIN - USAGE_TOOLTIP_OFFSET;
  const spaceBelow =
    viewportHeight - rect.bottom - USAGE_TOOLTIP_VIEWPORT_MARGIN - USAGE_TOOLTIP_OFFSET;
  const openUp = spaceAbove >= spaceBelow;

  return openUp
    ? {
        position: 'fixed',
        bottom: viewportHeight - rect.top + USAGE_TOOLTIP_OFFSET,
        left,
        width,
        zIndex: USAGE_TOOLTIP_Z_INDEX,
      }
    : {
        position: 'fixed',
        top: rect.bottom + USAGE_TOOLTIP_OFFSET,
        left,
        width,
        zIndex: USAGE_TOOLTIP_Z_INDEX,
      };
};

const formatRate = (value: number | undefined | null) => {
  if (value === undefined || value === null || !Number.isFinite(value)) return '—';
  return formatNumber(value, 4);
};

const isManualSource = (source?: string) => {
  const s = (source || '').toLowerCase();
  return s === '' || s === 'manual' || s === 'override';
};

const selectText = (element: HTMLElement) => {
  const selection = window.getSelection();
  if (!selection) return;
  const range = document.createRange();
  range.selectNodeContents(element);
  selection.removeAllRanges();
  selection.addRange(range);
};

function UsageTokenDetails({ event }: { event: UsageEvent }) {
  const { t } = useTranslation();
  const anchorRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [tooltipStyle, setTooltipStyle] = useState<CSSProperties | null>(null);

  const updateTooltipStyle = useCallback(() => {
    if (anchorRef.current) {
      setTooltipStyle(resolveUsageTooltipStyle(anchorRef.current));
    }
  }, []);

  useLayoutEffect(() => {
    if (!open) {
      setTooltipStyle(null);
      return;
    }
    updateTooltipStyle();
    const handleViewportChange = () => updateTooltipStyle();
    window.addEventListener('resize', handleViewportChange);
    window.addEventListener('scroll', handleViewportChange, true);
    return () => {
      window.removeEventListener('resize', handleViewportChange);
      window.removeEventListener('scroll', handleViewportChange, true);
    };
  }, [open, updateTooltipStyle]);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (anchorRef.current && !anchorRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [open]);

  const details = getTokenDetailLines(event, {
    total: t('monitoring.usage_total'),
    input: t('monitoring.usage_input'),
    output: t('monitoring.usage_output'),
    reasoning: t('monitoring.usage_reasoning'),
    cacheRead: t('monitoring.usage_cache_read'),
    cacheCreation: t('monitoring.usage_cache_creation'),
    legacyCached: t('monitoring.usage_cached_legacy'),
  });

  const tooltip = (
    <div className={styles.usageTooltip} role="tooltip" style={tooltipStyle ?? undefined}>
      {details.map((detail) => (
        <div className={styles.usageTooltipLine} key={detail.label}>
          <span>{detail.label}</span>
          <strong>{detail.value}</strong>
        </div>
      ))}
    </div>
  );

  return (
    <div
      ref={anchorRef}
      className={styles.usageAnchor}
      tabIndex={0}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
      onPointerDown={(pointerEvent) => {
        if (pointerEvent.pointerType === 'touch') {
          pointerEvent.preventDefault();
          setOpen((previous) => !previous);
        }
      }}
    >
      <span className={styles.num}>{formatCompactTokens(event.total_tokens)}</span>
      <span className={styles.cellSecondary}>{formatVisibleTokenBreakdown(event)}</span>
      {open && typeof document !== 'undefined' ? createPortal(tooltip, document.body) : null}
    </div>
  );
}

const MonitoringEventRow = memo(function MonitoringEventRow({
  event,
  apiKeyLabels,
  formatApiKeyDisplay,
  failedLabel,
  successLabel,
  ttftLabel,
  elapsedLabel,
  recentStatusData,
  tpsHint,
}: {
  event: UsageEvent;
  apiKeyLabels: Record<string, string>;
  formatApiKeyDisplay: (key?: string | null, hash?: string | null) => string;
  failedLabel: string;
  successLabel: string;
  ttftLabel: string;
  elapsedLabel: string;
  tpsHint: string;
  recentStatusData?: StatusBarData;
}) {
  return (
    <TableRow>
      <TableCell>
        <div className={styles.cellStack}>
          <span
            className={`${styles.cellPrimary} ${styles.mono}`}
            title={event.source || event.auth_index || undefined}
          >
            {event.source || event.auth_index || '—'}
          </span>
          {event.provider ? <span className={styles.cellSecondary}>{event.provider}</span> : null}
        </div>
      </TableCell>
      <TableCell>
        <div className={styles.cellStack}>
          <span
            className={styles.mono}
            title={formatApiKeyDisplay(event.api_key, event.api_key_hash)}
          >
            {formatApiKeyDisplay(event.api_key, event.api_key_hash)}
          </span>
          {event.api_key && apiKeyLabels[event.api_key] ? (
            <span className={`${styles.cellSecondary} ${styles.mono}`} title={event.api_key}>
              {event.api_key}
            </span>
          ) : null}
        </div>
      </TableCell>
      <TableCell>
        <span className={styles.mono} title={event.model || event.alias || undefined}>
          {event.model || event.alias || '—'}
        </span>
      </TableCell>
      <TableCell>
        <div className={styles.cellStack} title={getServiceTierTitle(event)}>
          <span className={styles.cellPrimary}>{event.reasoning_effort || '—'}</span>
          <span className={styles.cellSecondary}>{getEffectiveServiceTier(event) || '—'}</span>
        </div>
      </TableCell>
      <TableCell>
        {recentStatusData ? (
          <ProviderStatusBar statusData={recentStatusData} styles={statusBarStyles} />
        ) : (
          '—'
        )}
      </TableCell>
      <TableCell>
        <div className={styles.cellStack}>
          {event.failed ? (
            <span className={styles.statusFail}>{event.fail_status_code || failedLabel}</span>
          ) : (
            <span className={styles.statusOk}>{successLabel}</span>
          )}
          {event.fail_summary ? (
            <span
              className={`${styles.cellSecondary} ${styles.failureSummary}`}
              title={event.fail_summary}
              onDoubleClick={(e) => selectText(e.currentTarget)}
            >
              {event.fail_summary}
            </span>
          ) : null}
        </div>
      </TableCell>
      <TableCell>
        <div className={styles.latencyStack}>
          <span className={styles.latencyLine}>
            <span>{ttftLabel}</span>
            <strong>{formatDuration(event.ttft_ms)}</strong>
          </span>
          <span className={styles.latencyLine}>
            <span>{elapsedLabel}</span>
            <strong>{formatDuration(event.latency_ms)}</strong>
          </span>
        </div>
      </TableCell>
      <TableCell title={tpsHint}>
        <span className={styles.num}>
          {formatRate(calculateOutputTps(event.output_tokens, event.latency_ms))}
        </span>
      </TableCell>
      <TableCell>
        <span className={styles.timestampStack} title={formatTime(event.timestamp_ms)}>
          <span>{formatTimestampParts(event.timestamp_ms).date}</span>
          <span>{formatTimestampParts(event.timestamp_ms).time}</span>
        </span>
      </TableCell>
      <TableCell alignRight>
        <UsageTokenDetails event={event} />
      </TableCell>
      <TableCell alignRight>
        <span className={styles.num}>{formatUsd(event.estimated_cost)}</span>
      </TableCell>
    </TableRow>
  );
});

export function MonitoringPage() {
  const { t } = useTranslation();
  const showNotification = useNotificationStore((s) => s.showNotification);

  const [range, setRange] = useState<MonitoringRange>({ preset: '24h' });
  const [customOpen, setCustomOpen] = useState(false);
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [rangeError, setRangeError] = useState('');
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const openCustom = () => {
    const bounds = monitoringBounds(range.preset === 'all' ? { preset: '24h' } : range);
    setCustomStart(localDateTime(bounds.from_ms!));
    setCustomEnd(localDateTime(bounds.to_ms!));
    setRangeError('');
    setCustomOpen(true);
  };
  const applyCustom = () => {
    const from = parseLocalDateTime(customStart);
    const to = parseLocalDateTime(customEnd);
    if (from === null || to === null || from >= to) {
      setRangeError(t('monitoring.range_invalid'));
      return;
    }
    setRange({ preset: 'custom', from_ms: from, to_ms: to });
    setCustomOpen(false);
  };
  const [tab, setTab] = useState<MonitoringTab>('realtime');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search), 300);
    return () => window.clearTimeout(timer);
  }, [search]);
  const [model, setModel] = useState('');
  const [provider, setProvider] = useState('');
  const [source, setSource] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'success' | 'failed'>('all');
  const [liveEnabled, setLiveEnabled] = useState(true);
  const liveAvailable = range.preset !== 'custom' && tab !== 'prices';
  const isLive = liveEnabled && liveAvailable;
  const [apiKeyLabels, setApiKeyLabels] = useState<Record<string, string>>({});
  const [prices, setPrices] = useState<ModelPrice[]>([]);
  const [aliases, setAliases] = useState<ModelPriceAlias[]>([]);
  const [unpriced, setUnpriced] = useState<string[]>([]);

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
  const filters = useMemo<UsageQuery>(
    () => ({
      search: debouncedSearch.trim() || undefined,
      models: model ? [model] : undefined,
      providers: provider ? [provider] : undefined,
      sources: source.trim() ? [source.trim()] : undefined,
      api_keys: apiKey.trim() ? [apiKey.trim()] : undefined,
      failed_only: statusFilter === 'failed' || undefined,
      success_only: statusFilter === 'success' || undefined,
    }),
    [debouncedSearch, model, provider, source, apiKey, statusFilter]
  );
  const {
    events,
    summary,
    accounts,
    apiKeyStats,
    recent,
    filterOptions,
    statsEnabledHint,
    busy,
    errors,
    refresh: loadCore,
  } = useMonitoringData(filters, range, tab, liveEnabled ? 5_000 : 0);
  const loading = Object.values(busy).some(Boolean);
  const sectionLabels = {
    events: t('monitoring.tab_realtime'),
    summary: t('monitoring.section_summary'),
    filters: t('monitoring.section_filters'),
    accounts: t('monitoring.tab_accounts'),
    api_keys: t('monitoring.tab_api_keys'),
    recent: t('monitoring.recent_status'),
  };

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
    loadCore();
    void loadApiKeyLabels();
    if (tab === 'prices') await loadPrices();
  }, [loadCore, loadApiKeyLabels, loadPrices, tab]);

  useHeaderRefresh(refresh);
  useEffect(() => {
    void loadApiKeyLabels();
  }, [loadApiKeyLabels]);
  useEffect(() => {
    if (tab === 'prices') void loadPrices();
  }, [tab, loadPrices]);

  const clearFilters = () => {
    setSearch('');
    setModel('');
    setProvider('');
    setSource('');
    setApiKey('');
    setStatusFilter('all');
    setRange({ preset: '24h' });
    setDebouncedSearch('');
  };

  // When cascaded options shrink, drop selections that no longer exist in the data.
  useEffect(() => {
    if (!filterOptions) return;

    const hasValue = (values: string[] | undefined, pick: string) =>
      Boolean(pick) && (values || []).includes(pick);

    if (model && !hasValue(filterOptions.models, model)) {
      setModel('');
    }
    if (provider && !hasValue(filterOptions.providers, provider)) {
      setProvider('');
    }
    if (source && !hasValue(filterOptions.sources, source)) {
      setSource('');
    }
    if (apiKey && !hasValue(filterOptions.api_keys, apiKey)) {
      setApiKey('');
    }
  }, [filterOptions, model, provider, source, apiKey]);

  const enableStatistics = async () => {
    try {
      await apiClient.put('/usage-statistics-enabled', { value: true });
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

  // Prefer backend net_input_tokens (per-row billable input, summed in SQL).
  // Deriving net as aggregate(input) - aggregate(cache_read) under-counts longer
  // ranges when rows mix OpenAI-style inclusive input with Anthropic-style net input.
  const netInputTokens = summary
    ? summary.net_input_tokens !== undefined && summary.net_input_tokens !== null
      ? summary.net_input_tokens
      : summary.input_tokens >= summary.cache_read_tokens
        ? summary.input_tokens - summary.cache_read_tokens
        : summary.input_tokens
    : undefined;

  const rangeOptions: Array<[PresetRange, string]> = [
    ['24h', t('monitoring.range_24h')],
    ['7d', '7d'],
    ['14d', '14d'],
    ['30d', '30d'],
    ['all', t('monitoring.range_all')],
  ];

  const providerOptions = useMemo(() => {
    const values = [...(filterOptions?.providers || [])];
    // Keep the active selection visible for one frame before cascade auto-clear.
    if (provider && !values.includes(provider)) values.unshift(provider);
    return [
      { value: '', label: t('monitoring.filter_providers') },
      ...values.map((p) => ({ value: p, label: p })),
    ];
  }, [filterOptions?.providers, provider, t]);

  const modelOptions = useMemo(() => {
    const values = [...(filterOptions?.models || [])];
    if (model && !values.includes(model)) values.unshift(model);
    return [
      { value: '', label: t('monitoring.filter_models') },
      ...values.map((m) => ({ value: m, label: m })),
    ];
  }, [filterOptions?.models, model, t]);

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
    const values = Array.from(new Set((filterOptions?.sources || []).filter(Boolean)));
    if (source && !values.includes(source)) values.push(source);
    values.sort((a, b) => a.localeCompare(b));
    return [
      { value: '', label: t('monitoring.filter_sources') },
      ...values.map((s) => ({ value: s, label: s })),
    ];
  }, [filterOptions?.sources, source, t]);

  const accountStatusByKey = useMemo(() => {
    const map = new Map<string, StatusBarData>();
    for (const account of recent) {
      if (account.recent_requests) {
        map.set(
          accountStatusKey(account),
          statusBarDataFromRecentRequests(account.recent_requests)
        );
      }
    }
    return map;
  }, [recent]);

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
    const values = Array.from(new Set((filterOptions?.api_keys || []).filter(Boolean)));
    if (apiKey && !values.includes(apiKey)) values.push(apiKey);
    values.sort((a, b) => {
      const la = formatApiKeyDisplay(a).toLowerCase();
      const lb = formatApiKeyDisplay(b).toLowerCase();
      return la.localeCompare(lb) || a.localeCompare(b);
    });
    return [
      { value: '', label: t('monitoring.filter_api_keys') },
      ...values.map((k) => ({
        value: k,
        // Prefer config label when set; otherwise the raw key.
        label: apiKeyLabels[k] || k,
      })),
    ];
  }, [filterOptions?.api_keys, apiKey, apiKeyLabels, formatApiKeyDisplay, t]);

  const tabs: Array<[MonitoringTab, string, number | null]> = [
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
      <Modal
        open={customOpen}
        title={t('monitoring.range_custom')}
        onClose={() => setCustomOpen(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setCustomOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button onClick={applyCustom}>{t('monitoring.range_apply')}</Button>
          </>
        }
      >
        <p>{t('monitoring.range_timezone', { timezone })}</p>
        <Input
          type="datetime-local"
          step={1}
          label={t('monitoring.range_start')}
          value={customStart}
          onChange={(event) => setCustomStart(event.target.value)}
        />
        <Input
          type="datetime-local"
          step={1}
          label={t('monitoring.range_end')}
          value={customEnd}
          onChange={(event) => setCustomEnd(event.target.value)}
          error={rangeError}
        />
      </Modal>
      <div className={styles.filterSection}>
        <div className={styles.filterPrimary}>
          <div className={styles.rangeGroup} role="group" aria-label={t('monitoring.range_label')}>
            {rangeOptions.map(([key, label]) => (
              <button
                key={key}
                type="button"
                className={`${styles.rangeChip} ${range.preset === key ? styles.rangeChipActive : ''}`}
                aria-pressed={range.preset === key}
                onClick={() => setRange({ preset: key })}
              >
                {label}
              </button>
            ))}
            <button
              type="button"
              className={`${styles.rangeChip} ${range.preset === 'custom' ? styles.rangeChipActive : ''}`}
              aria-pressed={range.preset === 'custom'}
              title={
                range.preset === 'custom'
                  ? `${formatTime(range.from_ms)} — ${formatTime(range.to_ms)} (${timezone})`
                  : undefined
              }
              onClick={openCustom}
            >
              {t('monitoring.range_custom')}
            </button>
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
            <button
              type="button"
              className={`${styles.liveControl} ${isLive ? styles.liveActive : styles.livePaused}`}
              aria-pressed={isLive}
              aria-label={t('monitoring.live_toggle')}
              disabled={!liveAvailable}
              title={t(
                !liveAvailable
                  ? 'monitoring.live_unavailable'
                  : isLive
                    ? 'monitoring.live_pause_hint'
                    : 'monitoring.live_resume_hint'
              )}
              onClick={() => setLiveEnabled((enabled) => !enabled)}
            >
              <span className={styles.liveDot} aria-hidden="true" />
              {t(isLive ? 'monitoring.live' : 'monitoring.paused')}
            </button>
          </div>
        </div>

        <div className={styles.filterSecondary}>
          <SearchableSelect
            className={styles.filterSelect}
            value={source}
            options={sourceOptions}
            onChange={setSource}
            ariaLabel={t('monitoring.filter_sources')}
            searchPlaceholder={t('monitoring.filter_type_to_search')}
            emptyMessage={t('monitoring.filter_no_matches')}
            size="sm"
            fullWidth
          />
          <SearchableSelect
            className={styles.filterSelect}
            value={apiKey}
            options={apiKeyOptions}
            onChange={setApiKey}
            ariaLabel={t('monitoring.filter_api_keys')}
            searchPlaceholder={t('monitoring.filter_type_to_search')}
            emptyMessage={t('monitoring.filter_no_matches')}
            size="sm"
            fullWidth
          />
          <SearchableSelect
            className={styles.filterSelect}
            value={provider}
            options={providerOptions}
            onChange={setProvider}
            ariaLabel={t('monitoring.filter_providers')}
            searchPlaceholder={t('monitoring.filter_type_to_search')}
            emptyMessage={t('monitoring.filter_no_matches')}
            size="sm"
            fullWidth
          />
          <SearchableSelect
            className={styles.filterSelect}
            value={model}
            options={modelOptions}
            onChange={setModel}
            ariaLabel={t('monitoring.filter_models')}
            searchPlaceholder={t('monitoring.filter_type_to_search')}
            emptyMessage={t('monitoring.filter_no_matches')}
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

      {Object.entries(errors)
        .filter(([, message]) => message)
        .map(([section, message]) => (
          <div key={section} className={`${styles.banner} ${styles.bannerError}`} role="alert">
            <span>
              {sectionLabels[section as keyof typeof sectionLabels]}: {message}
            </span>
            <Button variant="secondary" size="sm" onClick={() => void refresh()}>
              {t('common.retry')}
            </Button>
          </div>
        ))}

      <div className={styles.summaryGrid} aria-busy={Boolean(busy.summary)}>
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
            }}
          >
            {label}
            {count !== null ? <span className={styles.tabCount}>{count}</span> : null}
          </button>
        ))}
      </div>

      {tab === 'realtime' ? (
        <div className={`${styles.tableSection} ${styles.eventsTableSection}`}>
          {events.length === 0 ? (
            <div className={styles.emptyWrap}>
              <EmptyState
                title={t(busy.events ? 'common.loading' : 'monitoring.empty_events')}
                description={t('monitoring.empty_events_hint')}
              />
            </div>
          ) : (
            <Table
              className={styles.eventsTable}
              cols={
                <>
                  <col style={{ width: '14%' }} />
                  <col style={{ width: '14%' }} />
                  <col style={{ width: '11%' }} />
                  <col style={{ width: '8%' }} />
                  <col style={{ width: '14%' }} />
                  <col style={{ width: '8%' }} />
                  <col style={{ width: '9%' }} />
                  <col style={{ width: '6%' }} />
                  <col style={{ width: '11%' }} />
                  <col style={{ width: '10%' }} />
                  <col style={{ width: '5%' }} />
                </>
              }
            >
              <TableHeader>
                <TableRow>
                  <TableHead>{t('monitoring.col_source')}</TableHead>
                  <TableHead>{t('monitoring.col_api_key')}</TableHead>
                  <TableHead>{t('monitoring.col_model')}</TableHead>
                  <TableHead>{t('monitoring.col_effort')}</TableHead>
                  <TableHead>{t('monitoring.recent_status')}</TableHead>
                  <TableHead>{t('monitoring.col_status')}</TableHead>
                  <TableHead>{t('monitoring.col_latency')}</TableHead>
                  <TableHead>{t('monitoring.col_tps')}</TableHead>
                  <TableHead>{t('monitoring.col_time')}</TableHead>
                  <TableHead alignRight>{t('monitoring.col_usage')}</TableHead>
                  <TableHead alignRight>{t('monitoring.col_cost')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {events.map((event) => (
                  <MonitoringEventRow
                    key={event.id}
                    event={event}
                    apiKeyLabels={apiKeyLabels}
                    formatApiKeyDisplay={formatApiKeyDisplay}
                    failedLabel={t('monitoring.status_failed')}
                    successLabel={t('monitoring.status_success')}
                    ttftLabel={t('monitoring.col_ttft')}
                    elapsedLabel={t('monitoring.col_elapsed')}
                    tpsHint={t('monitoring.tps_hint')}
                    recentStatusData={accountStatusByKey.get(getAccountStatusKeyForEvent(event))}
                  />
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
              <EmptyState
                title={t(busy.accounts ? 'common.loading' : 'monitoring.empty_accounts')}
              />
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
              <EmptyState
                title={t(busy.api_keys ? 'common.loading' : 'monitoring.empty_api_keys')}
              />
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
