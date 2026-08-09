/**
 * Quota cache that survives route switches.
 */

import { create } from 'zustand';
import type {
  AntigravityQuotaState,
  ClaudeQuotaState,
  CodexQuotaState,
  KimiQuotaState,
  QoderCNQuotaState,
  XaiQuotaState,
} from '@/types';

type QuotaUpdater<T> = T | ((prev: T) => T);

interface QuotaStoreState {
  cacheGeneration: number;
  fileGenerations: Record<string, number>;
  antigravityQuota: Record<string, AntigravityQuotaState>;
  claudeQuota: Record<string, ClaudeQuotaState>;
  codexQuota: Record<string, CodexQuotaState>;
  kimiQuota: Record<string, KimiQuotaState>;
  qodercnQuota: Record<string, QoderCNQuotaState>;
  xaiQuota: Record<string, XaiQuotaState>;
  setAntigravityQuota: (updater: QuotaUpdater<Record<string, AntigravityQuotaState>>) => void;
  setClaudeQuota: (updater: QuotaUpdater<Record<string, ClaudeQuotaState>>) => void;
  setCodexQuota: (updater: QuotaUpdater<Record<string, CodexQuotaState>>) => void;
  setKimiQuota: (updater: QuotaUpdater<Record<string, KimiQuotaState>>) => void;
  setQoderCNQuota: (updater: QuotaUpdater<Record<string, QoderCNQuotaState>>) => void;
  setXaiQuota: (updater: QuotaUpdater<Record<string, XaiQuotaState>>) => void;
  clearQuotaForFile: (name: string) => void;
  clearQuotaCache: () => void;
}

const resolveUpdater = <T>(updater: QuotaUpdater<T>, prev: T): T => {
  if (typeof updater === 'function') {
    return (updater as (value: T) => T)(prev);
  }
  return updater;
};

export const useQuotaStore = create<QuotaStoreState>((set) => ({
  cacheGeneration: 0,
  fileGenerations: {},
  antigravityQuota: {},
  claudeQuota: {},
  codexQuota: {},
  kimiQuota: {},
  qodercnQuota: {},
  xaiQuota: {},
  setAntigravityQuota: (updater) =>
    set((state) => ({
      antigravityQuota: resolveUpdater(updater, state.antigravityQuota),
    })),
  setClaudeQuota: (updater) =>
    set((state) => ({
      claudeQuota: resolveUpdater(updater, state.claudeQuota),
    })),
  setCodexQuota: (updater) =>
    set((state) => ({
      codexQuota: resolveUpdater(updater, state.codexQuota),
    })),
  setKimiQuota: (updater) =>
    set((state) => ({
      kimiQuota: resolveUpdater(updater, state.kimiQuota),
    })),
  setQoderCNQuota: (updater) =>
    set((state) => ({
      qodercnQuota: resolveUpdater(updater, state.qodercnQuota),
    })),
  setXaiQuota: (updater) =>
    set((state) => ({
      xaiQuota: resolveUpdater(updater, state.xaiQuota),
    })),
  clearQuotaForFile: (name) =>
    set((state) => {
      const remove = <T,>(values: Record<string, T>): Record<string, T> => {
        if (!(name in values)) return values;
        const next = { ...values };
        delete next[name];
        return next;
      };
      return {
        fileGenerations: {
          ...state.fileGenerations,
          [name]: (state.fileGenerations[name] ?? 0) + 1,
        },
        antigravityQuota: remove(state.antigravityQuota),
        claudeQuota: remove(state.claudeQuota),
        codexQuota: remove(state.codexQuota),
        kimiQuota: remove(state.kimiQuota),
        qodercnQuota: remove(state.qodercnQuota),
        xaiQuota: remove(state.xaiQuota),
      };
    }),
  clearQuotaCache: () =>
    set((state) => ({
      cacheGeneration: state.cacheGeneration + 1,
      fileGenerations: {},
      antigravityQuota: {},
      claudeQuota: {},
      codexQuota: {},
      kimiQuota: {},
      qodercnQuota: {},
      xaiQuota: {},
    })),
}));

export type QuotaCacheToken = {
  cacheGeneration: number;
  fileName?: string;
  fileGeneration: number;
};

export const captureQuotaCacheGeneration = (fileName?: string): QuotaCacheToken => {
  const state = useQuotaStore.getState();
  return {
    cacheGeneration: state.cacheGeneration,
    fileName,
    fileGeneration: fileName ? (state.fileGenerations[fileName] ?? 0) : 0,
  };
};

export const isQuotaCacheCurrent = (token: QuotaCacheToken): boolean => {
  const state = useQuotaStore.getState();
  if (state.cacheGeneration !== token.cacheGeneration) return false;
  if (!token.fileName) return true;
  return (state.fileGenerations[token.fileName] ?? 0) === token.fileGeneration;
};

export const commitIfQuotaCacheCurrent = (
  token: QuotaCacheToken,
  commit: () => void
): boolean => {
  if (!isQuotaCacheCurrent(token)) return false;
  commit();
  return true;
};
