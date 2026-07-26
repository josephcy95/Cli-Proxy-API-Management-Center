/**
 * Model context window overrides (management API).
 *
 * The backend resolves context windows by exact model-ID match against a bundled
 * catalog, so custom providers with non-standard model names advertise no context
 * window at all. These endpoints list what is missing and let an operator set the
 * value manually.
 */

import { apiClient } from './client';
import { isRecord } from '@/utils/helpers';
import type {
  ModelContextEntry,
  ModelContextOverride,
  ModelContextStatus,
  RawModelContextEntry,
  RawModelContextOverride,
} from '@/types/modelContext';

const toPositiveInteger = (value: unknown): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Math.floor(parsed);
};

export function normalizeModelContextOverride(raw: RawModelContextOverride): ModelContextOverride {
  return {
    model: String(raw?.model ?? '').trim(),
    contextLength: toPositiveInteger(raw?.['context-length']),
    maxCompletionTokens: toPositiveInteger(raw?.['max-completion-tokens']),
  };
}

export function normalizeModelContextEntry(raw: RawModelContextEntry): ModelContextEntry {
  const contextLength = toPositiveInteger(raw?.['context-length']);
  return {
    model: String(raw?.model ?? '').trim(),
    displayName: raw?.['display-name'] != null ? String(raw['display-name']) : '',
    type: raw?.type != null ? String(raw.type) : '',
    ownedBy: raw?.['owned-by'] != null ? String(raw['owned-by']) : '',
    providers: Array.isArray(raw?.providers) ? raw.providers.map((item) => String(item)) : [],
    contextLength,
    maxCompletionTokens: toPositiveInteger(raw?.['max-completion-tokens']),
    overridden: raw?.overridden === true,
    // Trust the server flag when present, else derive it from the value.
    resolved: typeof raw?.resolved === 'boolean' ? raw.resolved : contextLength > 0,
  };
}

export function normalizeModelContextStatus(raw: unknown): ModelContextStatus {
  if (!isRecord(raw)) {
    return { models: [], overrides: [], missingCount: 0 };
  }
  const models = Array.isArray(raw.models)
    ? raw.models.filter(isRecord).map((item) => normalizeModelContextEntry(item))
    : [];
  const overrides = Array.isArray(raw['model-context-overrides'])
    ? (raw['model-context-overrides'] as unknown[])
        .filter(isRecord)
        .map((item) => normalizeModelContextOverride(item))
        .filter((item) => item.model !== '')
    : [];
  const missingCount = Number.isFinite(Number(raw['missing-context-count']))
    ? Number(raw['missing-context-count'])
    : models.filter((item) => !item.resolved).length;

  return { models, overrides, missingCount };
}

function serializeModelContextOverride(override: ModelContextOverride): RawModelContextOverride {
  return {
    model: override.model.trim(),
    'context-length': Math.max(0, Math.floor(override.contextLength || 0)),
    'max-completion-tokens': Math.max(0, Math.floor(override.maxCompletionTokens || 0)),
  };
}

export const modelContextApi = {
  /** Every registered model plus its effective context window. */
  async getStatus(): Promise<ModelContextStatus> {
    const data = await apiClient.get<unknown>('/model-context-status');
    return normalizeModelContextStatus(data);
  },

  /** Replace the whole override list. */
  async putOverrides(overrides: ModelContextOverride[]): Promise<void> {
    await apiClient.put('/model-context-overrides', overrides.map(serializeModelContextOverride));
  },

  /** Upsert one override. Passing zero for both values clears it. */
  async patchOverride(override: ModelContextOverride): Promise<void> {
    await apiClient.patch('/model-context-overrides', serializeModelContextOverride(override));
  },

  /** Remove one override by model ID. */
  async deleteOverride(model: string): Promise<void> {
    await apiClient.delete(`/model-context-overrides?model=${encodeURIComponent(model)}`);
  },
};
