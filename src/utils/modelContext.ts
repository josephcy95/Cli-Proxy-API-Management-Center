import type { ModelContextEntry, ModelContextOverride } from '@/types/modelContext';

/** Draft values are kept as strings so the inputs can be cleared while editing. */
export interface ModelContextDraftValue {
  contextLength: string;
  maxCompletionTokens: string;
}

export type ModelContextDraftMap = Record<string, ModelContextDraftValue>;

export const toModelContextDraft = (entry: ModelContextEntry): ModelContextDraftValue => ({
  contextLength: entry.contextLength > 0 ? String(entry.contextLength) : '',
  maxCompletionTokens: entry.maxCompletionTokens > 0 ? String(entry.maxCompletionTokens) : '',
});

export const buildModelContextDraftMap = (entries: ModelContextEntry[]): ModelContextDraftMap => {
  const out: ModelContextDraftMap = {};
  entries.forEach((entry) => {
    out[entry.model] = toModelContextDraft(entry);
  });
  return out;
};

/** Parses a draft field, treating blanks, non-numbers and non-positives as unset. */
const parseCount = (value: string): number => {
  const trimmed = value.trim();
  if (trimmed === '') return 0;
  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return parsed;
};

/**
 * Collects the overrides that should be persisted. Models with no manual value are
 * dropped so that clearing an input removes the override, and catalog-resolved
 * models are only sent once the operator actually changes them.
 */
export function collectOverrides(
  entries: ModelContextEntry[],
  drafts: ModelContextDraftMap
): ModelContextOverride[] {
  const out: ModelContextOverride[] = [];
  entries.forEach((entry) => {
    const draft = drafts[entry.model];
    if (!draft) return;
    const contextLength = parseCount(draft.contextLength);
    const maxCompletionTokens = parseCount(draft.maxCompletionTokens);
    if (contextLength <= 0 && maxCompletionTokens <= 0) return;
    if (
      !entry.overridden &&
      entry.resolved &&
      contextLength === entry.contextLength &&
      maxCompletionTokens === entry.maxCompletionTokens
    ) {
      return;
    }
    out.push({ model: entry.model, contextLength, maxCompletionTokens });
  });
  return out;
}
