import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import {
  usageEventsApi,
  type UsageEvent,
  type UsageSummary,
  type UsageAccountStat,
  type UsageAPIKeyStat,
  type UsageAccountRecentRequests,
  type UsageFilterOptions,
  type UsageQuery,
} from '@/services/api/usageEvents';
import { getErrorMessage } from '@/utils/helpers';
import { monitoringBounds, type MonitoringRange } from './monitoringRange';

export type MonitoringTab = 'realtime' | 'accounts' | 'api_keys' | 'prices';
type Section = 'events' | 'summary' | 'filters' | 'accounts' | 'api_keys' | 'recent';
const sameRecord = (left: object, right: object) => {
  const previous = left as Record<string, unknown>;
  const next = right as Record<string, unknown>;
  const keys = Object.keys(next);
  return (
    keys.length === Object.keys(previous).length && keys.every((key) => previous[key] === next[key])
  );
};

const mergeEvents = (previous: UsageEvent[], next: UsageEvent[]) => {
  if (previous.length === 0) return next;
  const previousById = new Map(previous.map((event) => [event.id, event]));
  let changed = previous.length !== next.length;
  const merged = next.map((event) => {
    const previousEvent = previousById.get(event.id);
    if (!previousEvent || !sameRecord(previousEvent, event)) {
      changed = true;
      return event;
    }
    return previousEvent;
  });
  return changed ? merged : previous;
};

const sameStringList = (left: string[] | undefined, right: string[] | undefined) =>
  left !== undefined &&
  right !== undefined &&
  left.length === right.length &&
  left.every((value, index) => value === right[index]);

const sameFilterOptions = (left: UsageFilterOptions | null, right: UsageFilterOptions) =>
  left !== null &&
  sameStringList(left.models, right.models) &&
  sameStringList(left.providers, right.providers) &&
  sameStringList(left.auth_indices, right.auth_indices) &&
  sameStringList(left.sources, right.sources) &&
  sameStringList(left.api_keys, right.api_keys) &&
  sameStringList(left.api_key_hashes, right.api_key_hashes);

export function useMonitoringData(
  filters: UsageQuery,
  range: MonitoringRange,
  tab: MonitoringTab,
  autoMs: number
) {
  const [revision, refresh] = useReducer((value: number) => value + 1, 0);
  // One time snapshot per range/manual refresh, shared by every section.
  const timeBounds = useMemo(() => {
    void revision;
    return monitoringBounds(range);
  }, [range, revision]);
  const query = useMemo(() => ({ ...timeBounds, ...filters, limit: 200 }), [timeBounds, filters]);
  const facetKey = JSON.stringify({
    ...query,
    search: undefined,
    limit: undefined,
    fields: ['models', 'providers', 'sources', 'api_keys'],
    revision,
  });
  const [events, setEvents] = useState<UsageEvent[]>([]);
  const [summary, setSummary] = useState<UsageSummary | null>(null);
  const [accounts, setAccounts] = useState<UsageAccountStat[]>([]);
  const [apiKeyStats, setApiKeyStats] = useState<UsageAPIKeyStat[]>([]);
  const [recent, setRecent] = useState<UsageAccountRecentRequests[]>([]);
  const [filterOptions, setFilterOptions] = useState<UsageFilterOptions | null>(null);
  const [statsEnabledHint, setStatsEnabledHint] = useState<boolean | null>(null);
  const [busy, setBusy] = useState<Partial<Record<Section, boolean>>>({});
  const [errors, setErrors] = useState<Partial<Record<Section, string>>>({});
  const requests = useRef(new Map<Section, AbortController>());
  const legacyRecent = useRef(false);
  const selectionKey = JSON.stringify({ filters, range });
  const summarySelection = useRef('');
  const tableSelection = useRef('');

  const cancel = useCallback((section: Section) => {
    requests.current.get(section)?.abort();
    requests.current.delete(section);
  }, []);
  const run = useCallback(
    async <T>(
      section: Section,
      fetch: (signal: AbortSignal) => Promise<T>,
      apply: (data: T) => void
    ) => {
      cancel(section);
      const controller = new AbortController();
      requests.current.set(section, controller);
      setBusy((value) => ({ ...value, [section]: true }));
      setErrors((value) => ({ ...value, [section]: '' }));
      try {
        const data = await fetch(controller.signal);
        if (!controller.signal.aborted) apply(data);
      } catch (error) {
        if (!controller.signal.aborted)
          setErrors((value) => ({ ...value, [section]: getErrorMessage(error) }));
      } finally {
        if (requests.current.get(section) === controller) {
          requests.current.delete(section);
          setBusy((value) => ({ ...value, [section]: false }));
        }
      }
    },
    [cancel]
  );

  const loadTable = useCallback(
    (q: UsageQuery) => {
      if (tab === 'accounts')
        return run(
          'accounts',
          (signal) => usageEventsApi.getAccountStats(q, signal),
          (res) => setAccounts(res.accounts || [])
        );
      if (tab === 'api_keys')
        return run(
          'api_keys',
          (signal) => usageEventsApi.getAPIKeyStats(q, signal),
          (res) => setApiKeyStats(res.api_keys || [])
        );
      if (tab !== 'realtime') return Promise.resolve();
      cancel('recent');
      return run(
        'events',
        (signal) => usageEventsApi.listEvents(q, signal),
        (res) => {
          const rows = res.events || [];
          setEvents((previous) => mergeEvents(previous, rows));
          const groups = Array.from(
            new Map(
              rows.map(({ auth_index, source, source_hash, provider }) => {
                const group = { auth_index, source, source_hash, provider };
                return [JSON.stringify(group), group] as const;
              })
            ).values()
          );
          if (!groups.length) {
            setRecent([]);
            setBusy((value) => ({ ...value, recent: false }));
            return;
          }
          void run(
            'recent',
            async (signal) => {
              if (!legacyRecent.current) {
                try {
                  return await usageEventsApi.getAccountRecentRequests(q, groups, signal);
                } catch (error) {
                  if (signal.aborted || (error as { status?: number }).status !== 404) throw error;
                  legacyRecent.current = true;
                }
              }
              return usageEventsApi.getAccountStats(q, signal);
            },
            (result) => setRecent(result.accounts || [])
          );
        }
      );
    },
    [tab, run, cancel]
  );

  useEffect(() => {
    if (summarySelection.current !== selectionKey) setSummary(null);
    summarySelection.current = selectionKey;
    void run(
      'summary',
      (signal) => usageEventsApi.getSummary(query, signal),
      (res) => {
        setSummary(res.summary || null);
        setStatsEnabledHint(res.usage_statistics_enabled ?? null);
      }
    );
    return () => cancel('summary');
  }, [query, selectionKey, run, cancel]);

  useEffect(() => {
    setFilterOptions(null);
    const q = JSON.parse(facetKey);
    delete q.revision;
    void run(
      'filters',
      (signal) => usageEventsApi.getFilterOptions(q, signal),
      (res) => {
        setFilterOptions((previous) => (sameFilterOptions(previous, res) ? previous : res));
      }
    );
    return () => cancel('filters');
  }, [facetKey, run, cancel]);

  useEffect(() => {
    // Keep the previous result visible while the new range loads; clearing it causes
    // the table/cards to collapse and creates a distracting layout shift.
    tableSelection.current = `${selectionKey}:${tab}`;
    setBusy((value) => ({
      ...value,
      events: false,
      accounts: false,
      api_keys: false,
      recent: false,
    }));
    setErrors((value) => ({ ...value, events: '', accounts: '', api_keys: '', recent: '' }));
    void loadTable(query);
    return () => {
      cancel('events');
      cancel('accounts');
      cancel('api_keys');
      cancel('recent');
    };
  }, [query, selectionKey, tab, loadTable, cancel]);

  useEffect(() => {
    if (!autoMs || range.preset === 'custom' || tab === 'prices') return;
    const timer = window.setInterval(() => {
      if (document.hidden || requests.current.size) return;
      void loadTable({ ...filters, ...monitoringBounds(range), limit: 200 });
    }, autoMs);
    return () => window.clearInterval(timer);
  }, [autoMs, filters, range, tab, loadTable]);

  return {
    events,
    summary,
    accounts,
    apiKeyStats,
    recent,
    filterOptions,
    statsEnabledHint,
    busy,
    errors,
    refresh,
  };
}
