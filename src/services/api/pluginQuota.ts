import type { TFunction } from 'i18next';
import type {
  AntigravityQuotaSubscription,
  AntigravityQuotaSummaryPayload,
  AuthFileItem,
  PluginQuotaMetric,
  PluginQuotaState,
} from '@/types';
import { apiClient } from '@/services/api/client';
import { normalizeAuthIndex } from '@/utils/authIndex';
import { buildAntigravityQuotaGroups } from '@/utils/quota';
import { guardConfigConnection } from './connectionGuard';

type PluginQuotaPayload = AntigravityQuotaSummaryPayload & {
  subscription?: Partial<AntigravityQuotaSubscription> | null;
  summary?: Array<Partial<PluginQuotaMetric>>;
};

export type PluginQuotaData = {
  groups: PluginQuotaState['groups'];
  subscription: AntigravityQuotaSubscription | null;
  summary: PluginQuotaMetric[];
};

export const normalizePluginQuotaSummary = (
  summary: PluginQuotaPayload['summary']
): PluginQuotaMetric[] => {
  if (!Array.isArray(summary)) return [];
  return summary.flatMap((metric) => {
    const key = typeof metric.key === 'string' ? metric.key.trim() : '';
    const label = typeof metric.label === 'string' ? metric.label.trim() : '';
    if (!key || !label || typeof metric.value !== 'number' || !Number.isFinite(metric.value))
      return [];
    const format =
      metric.format === 'currency' || metric.format === 'number' ? metric.format : undefined;
    const unit =
      typeof metric.unit === 'string' && metric.unit.trim() ? metric.unit.trim() : undefined;
    const currency =
      format === 'currency' &&
      typeof metric.currency === 'string' &&
      /^[A-Z]{3}$/.test(metric.currency)
        ? metric.currency
        : undefined;
    return [{ key, label, value: metric.value, unit, format, currency }];
  });
};

const normalizeSubscription = (
  subscription: PluginQuotaPayload['subscription']
): AntigravityQuotaSubscription | null => {
  if (!subscription) return null;
  const value = (field: unknown) =>
    typeof field === 'string' && field.trim() ? field.trim() : null;
  return {
    plan: value(subscription.plan),
    tierName: value(subscription.tierName),
    tierId: value(subscription.tierId),
  };
};

export const fetchPluginQuota = async (
  file: AuthFileItem,
  t: TFunction
): Promise<PluginQuotaData> => {
  const assertConnection = guardConfigConnection();
  const authIndex = normalizeAuthIndex(file.authIndex ?? file['auth_index']);
  if (!authIndex) throw new Error(t('plugin_quota.missing_auth_index'));

  const advertisedId = String(file.quotaPluginId ?? file['quota_plugin_id'] ?? '').trim();
  assertConnection();

  // The fork's credential route also supports declarative probes and providers
  // matched through DescribeQuota, which the plugin list does not expose.
  const payload = await apiClient.post<PluginQuotaPayload>(
    advertisedId ? `/plugins/${encodeURIComponent(advertisedId)}/quota` : '/quota/fetch',
    { auth_index: authIndex }
  );
  assertConnection();
  return {
    groups: buildAntigravityQuotaGroups(payload),
    subscription: normalizeSubscription(payload.subscription),
    summary: normalizePluginQuotaSummary(payload.summary),
  };
};
