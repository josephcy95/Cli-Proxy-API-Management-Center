import type { UsageEvent } from '@/services/api/usageEvents';
import type { StatusBarData, StatusBlockDetail, StatusBlockState } from '@/utils/recentRequests';

const STATUS_BLOCK_COUNT = 20;
const STATUS_BLOCK_DURATION_MS = 10 * 60 * 1000;

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
