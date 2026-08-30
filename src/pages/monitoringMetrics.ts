import type { UsageAccountStat, UsageEvent } from '@/services/api/usageEvents';
import type { StatusBarData, StatusBlockDetail, StatusBlockState } from '@/utils/recentRequests';

const STATUS_BLOCK_COUNT = 20;
const STATUS_BLOCK_DURATION_MS = 10 * 60 * 1000;

export const formatCompactTokens = (value: number | null | undefined): string => {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  if (Math.abs(value) < 1000) return Math.round(value).toString();
  const compact = (value / 1000).toFixed(1).replace(/\.0$/, '');
  return `${compact} K`;
};

export const formatVisibleTokenBreakdown = (event: UsageEvent): string =>
  `I ${formatCompactTokens(event.input_tokens)} · O ${formatCompactTokens(event.output_tokens)}`;

export interface TokenDetailLine {
  label: string;
  value: string;
}

export const getTokenDetailLines = (
  event: UsageEvent,
  labels: {
    total: string;
    input: string;
    output: string;
    reasoning: string;
    cacheRead: string;
    cacheCreation: string;
    legacyCached: string;
  }
): TokenDetailLine[] => {
  const lines: TokenDetailLine[] = [
    { label: labels.total, value: formatCompactTokens(event.total_tokens) },
    { label: labels.input, value: formatCompactTokens(event.input_tokens) },
    { label: labels.output, value: formatCompactTokens(event.output_tokens) },
  ];
  if (event.reasoning_tokens) {
    lines.push({ label: labels.reasoning, value: formatCompactTokens(event.reasoning_tokens) });
  }
  if (event.cache_read_tokens) {
    lines.push({ label: labels.cacheRead, value: formatCompactTokens(event.cache_read_tokens) });
  }
  if (event.cache_creation_tokens) {
    lines.push({
      label: labels.cacheCreation,
      value: formatCompactTokens(event.cache_creation_tokens),
    });
  }
  if (event.cached_tokens && !event.cache_read_tokens && !event.cache_creation_tokens) {
    lines.push({ label: labels.legacyCached, value: formatCompactTokens(event.cached_tokens) });
  }
  return lines;
};

export const formatTimestampParts = (ms: number): { date: string; time: string } => {
  if (!Number.isFinite(ms) || ms <= 0) return { date: '—', time: '—' };
  const value = new Date(ms);
  const pad = (part: number) => part.toString().padStart(2, '0');
  return {
    date: `${pad(value.getMonth() + 1)}/${pad(value.getDate())}/${value.getFullYear()}`,
    time: `${pad(value.getHours())}:${pad(value.getMinutes())}:${pad(value.getSeconds())}`,
  };
};

export const accountStatusKey = (
  stat: Pick<UsageAccountStat, 'auth_index' | 'source_hash' | 'source' | 'provider'>
) =>
  [stat.auth_index || '', stat.source_hash || stat.source || '', stat.provider || ''].join(
    '\u0000'
  );

export const calculateOutputTps = (
  outputTokens: number | null | undefined,
  latencyMs: number | null | undefined
): number | null => {
  if (
    outputTokens === null ||
    outputTokens === undefined ||
    latencyMs === null ||
    latencyMs === undefined ||
    !Number.isFinite(outputTokens) ||
    !Number.isFinite(latencyMs) ||
    outputTokens <= 0 ||
    latencyMs <= 0
  ) {
    return null;
  }
  return outputTokens / (latencyMs / 1000);
};

export const getEffectiveServiceTier = (event: UsageEvent): string | undefined =>
  event.service_tier || event.response_service_tier || undefined;

export const getAccountStatusKeyForEvent = (event: UsageEvent) =>
  accountStatusKey({
    auth_index: event.auth_index,
    source_hash: event.source_hash,
    source: event.source,
    provider: event.provider,
  });

export const getServiceTierTitle = (event: UsageEvent): string | undefined => {
  const requested = event.service_tier || '';
  const response = event.response_service_tier || '';
  if (requested && response && requested !== response) {
    return `Requested: ${requested}\nUpstream: ${response}`;
  }
  return requested || response || undefined;
};

export const buildRecentStatusData = (events: UsageEvent[], now = Date.now()): StatusBarData => {
  const windowStart = now - STATUS_BLOCK_COUNT * STATUS_BLOCK_DURATION_MS;
  const buckets = Array.from({ length: STATUS_BLOCK_COUNT }, () => ({ success: 0, failure: 0 }));

  for (const event of events) {
    if (
      !Number.isFinite(event.timestamp_ms) ||
      event.timestamp_ms < windowStart ||
      event.timestamp_ms > now
    ) {
      continue;
    }
    const index = Math.min(
      STATUS_BLOCK_COUNT - 1,
      Math.floor((event.timestamp_ms - windowStart) / STATUS_BLOCK_DURATION_MS)
    );
    if (event.failed) buckets[index].failure += 1;
    else buckets[index].success += 1;
  }

  const blocks: StatusBlockState[] = [];
  const blockDetails: StatusBlockDetail[] = [];
  let totalSuccess = 0;
  let totalFailure = 0;
  buckets.forEach(({ success, failure }, index) => {
    const total = success + failure;
    totalSuccess += success;
    totalFailure += failure;
    blocks.push(
      total === 0 ? 'idle' : failure === 0 ? 'success' : success === 0 ? 'failure' : 'mixed'
    );
    const startTime = windowStart + index * STATUS_BLOCK_DURATION_MS;
    blockDetails.push({
      success,
      failure,
      rate: total > 0 ? success / total : -1,
      startTime,
      endTime: startTime + STATUS_BLOCK_DURATION_MS,
    });
  });

  const total = totalSuccess + totalFailure;
  return {
    blocks,
    blockDetails,
    successRate: total > 0 ? (totalSuccess / total) * 100 : 100,
    totalSuccess,
    totalFailure,
  };
};
