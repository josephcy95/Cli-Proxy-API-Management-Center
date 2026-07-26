import { describe, expect, test } from 'bun:test';
import {
  normalizeModelContextEntry,
  normalizeModelContextStatus,
} from '@/services/api/modelContext';
import { collectOverrides } from '@/utils/modelContext';
import type { ModelContextEntry } from '@/types/modelContext';

const entry = (patch: Partial<ModelContextEntry>): ModelContextEntry => ({
  model: 'custom-a',
  displayName: '',
  type: '',
  ownedBy: '',
  providers: [],
  contextLength: 0,
  maxCompletionTokens: 0,
  overridden: false,
  resolved: false,
  ...patch,
});

describe('normalizeModelContextEntry', () => {
  test('maps kebab-case wire keys and derives resolved', () => {
    expect(
      normalizeModelContextEntry({
        model: 'my/custom-llm',
        'display-name': 'Custom LLM',
        'owned-by': 'acme',
        providers: ['openai-compatibility'],
        'context-length': 262144,
        'max-completion-tokens': 8192,
        overridden: true,
      })
    ).toEqual({
      model: 'my/custom-llm',
      displayName: 'Custom LLM',
      type: '',
      ownedBy: 'acme',
      providers: ['openai-compatibility'],
      contextLength: 262144,
      maxCompletionTokens: 8192,
      overridden: true,
      resolved: true,
    });
  });

  test('treats a missing or non-positive context length as unresolved', () => {
    expect(normalizeModelContextEntry({ model: 'x' }).resolved).toBe(false);
    expect(normalizeModelContextEntry({ model: 'x', 'context-length': 0 }).resolved).toBe(false);
    expect(normalizeModelContextEntry({ model: 'x', 'context-length': -5 }).contextLength).toBe(0);
  });
});

describe('normalizeModelContextStatus', () => {
  test('falls back to counting unresolved models when the server omits the count', () => {
    const status = normalizeModelContextStatus({
      models: [{ model: 'a', 'context-length': 1000 }, { model: 'b' }],
    });
    expect(status.models).toHaveLength(2);
    expect(status.missingCount).toBe(1);
  });

  test('returns an empty status for a malformed payload', () => {
    expect(normalizeModelContextStatus(null)).toEqual({
      models: [],
      overrides: [],
      missingCount: 0,
    });
  });
});

describe('collectOverrides', () => {
  test('keeps manual values for models missing a context window', () => {
    const entries = [entry({ model: 'custom-a' })];
    const drafts = { 'custom-a': { contextLength: '131072', maxCompletionTokens: '4096' } };
    expect(collectOverrides(entries, drafts)).toEqual([
      { model: 'custom-a', contextLength: 131072, maxCompletionTokens: 4096 },
    ]);
  });

  test('drops entries whose inputs are cleared so the override is removed', () => {
    const entries = [entry({ model: 'custom-a', contextLength: 8192, overridden: true })];
    const drafts = { 'custom-a': { contextLength: '', maxCompletionTokens: '' } };
    expect(collectOverrides(entries, drafts)).toEqual([]);
  });

  test('does not re-send catalog-resolved values that were left untouched', () => {
    const entries = [
      entry({
        model: 'claude-x',
        contextLength: 200000,
        maxCompletionTokens: 64000,
        resolved: true,
      }),
    ];
    const drafts = { 'claude-x': { contextLength: '200000', maxCompletionTokens: '64000' } };
    expect(collectOverrides(entries, drafts)).toEqual([]);
  });

  test('sends a catalog-resolved model once the operator changes it', () => {
    const entries = [
      entry({
        model: 'claude-x',
        contextLength: 200000,
        maxCompletionTokens: 64000,
        resolved: true,
      }),
    ];
    const drafts = { 'claude-x': { contextLength: '500000', maxCompletionTokens: '64000' } };
    expect(collectOverrides(entries, drafts)).toEqual([
      { model: 'claude-x', contextLength: 500000, maxCompletionTokens: 64000 },
    ]);
  });

  test('ignores non-numeric and negative input', () => {
    const entries = [entry({ model: 'custom-a' })];
    const drafts = { 'custom-a': { contextLength: 'abc', maxCompletionTokens: '-10' } };
    expect(collectOverrides(entries, drafts)).toEqual([]);
  });
});
