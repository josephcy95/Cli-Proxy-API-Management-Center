import { describe, expect, test } from 'bun:test';
import {
  getDefaultAuthFilesSortMode,
  isAuthFilesSortMode,
  normalizePersistedAuthFilesSortMode,
} from '@/features/authFiles/uiState';

describe('auth-files sort state', () => {
  test('defaults Codex to availability and other providers to priority', () => {
    expect(getDefaultAuthFilesSortMode('codex')).toBe('availability');
    expect(getDefaultAuthFilesSortMode('xai')).toBe('priority');
  });

  test('migrates obsolete plan sorts to the current provider default', () => {
    expect(normalizePersistedAuthFilesSortMode('plan-desc', 'codex')).toBe('availability');
    expect(normalizePersistedAuthFilesSortMode('plan-asc', 'xai')).toBe('priority');
    expect(normalizePersistedAuthFilesSortMode('availability', 'xai')).toBe('priority');
    expect(normalizePersistedAuthFilesSortMode('az', 'codex')).toBe('az');
    expect(normalizePersistedAuthFilesSortMode('unknown', 'codex')).toBeNull();
  });

  test('does not retain obsolete plan sort modes as valid values', () => {
    expect(isAuthFilesSortMode('plan-desc')).toBe(false);
    expect(isAuthFilesSortMode('plan-asc')).toBe(false);
    expect(isAuthFilesSortMode('availability')).toBe(true);
  });
});
