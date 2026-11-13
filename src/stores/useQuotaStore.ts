/**
 * Quota cache that survives route switches.
 */

import { create } from 'zustand';
import type {
  AntigravityQuotaState,
  ClaudeQuotaState,
  CodexCreditOverageEntry,
  CodexCreditOverageOperation,
  CodexQuotaState,
  DevinQuotaState,
  PluginQuotaState,
  KimiQuotaState,
  MetaQuotaState,
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
  /**
   * Account-level, keyed by codexCreditOverageKey(). Survives per-file invalidation
   * because removing one credential does not change the account setting.
   */
  codexCreditOverage: Record<string, CodexCreditOverageEntry>;
  /** A quota refresh must not release a pending or ambiguous mutation; auth resets it. */
  codexCreditOverageOperations: Record<string, CodexCreditOverageOperation>;
  devinQuota: Record<string, DevinQuotaState>;
  kimiQuota: Record<string, KimiQuotaState>;
  metaQuota: Record<string, MetaQuotaState>;
  qodercnQuota: Record<string, QoderCNQuotaState>;
  xaiQuota: Record<string, XaiQuotaState>;
  pluginQuota: Record<string, PluginQuotaState>;
  setPluginQuota: (updater: QuotaUpdater<Record<string, PluginQuotaState>>) => void;
  setCodexCreditOverage: (key: string, entry: CodexCreditOverageEntry | undefined) => void;
  setCodexCreditOverageOperation: (
    accountId: string,
    operation: CodexCreditOverageOperation | undefined
  ) => void;
  clearCodexCreditOverageOperations: () => void;
  setAntigravityQuota: (updater: QuotaUpdater<Record<string, AntigravityQuotaState>>) => void;
  setClaudeQuota: (updater: QuotaUpdater<Record<string, ClaudeQuotaState>>) => void;
  setCodexQuota: (updater: QuotaUpdater<Record<string, CodexQuotaState>>) => void;
  setKimiQuota: (updater: QuotaUpdater<Record<string, KimiQuotaState>>) => void;
  setMetaQuota: (updater: QuotaUpdater<Record<string, MetaQuotaState>>) => void;
  setQoderCNQuota: (updater: QuotaUpdater<Record<string, QoderCNQuotaState>>) => void;
  setXaiQuota: (updater: QuotaUpdater<Record<string, XaiQuotaState>>) => void;
  setDevinQuota: (updater: QuotaUpdater<Record<string, DevinQuotaState>>) => void;
  clearQuotaForFile: (name: string) => void;
  clearQuotaCache: (names?: string[]) => void;
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
  codexCreditOverage: {},
  codexCreditOverageOperations: {},
  devinQuota: {},
  kimiQuota: {},
  metaQuota: {},
  qodercnQuota: {},
  xaiQuota: {},
  pluginQuota: {},
  setPluginQuota: (updater) =>
    set((state) => ({ pluginQuota: resolveUpdater(updater, state.pluginQuota) })),
  setCodexCreditOverage: (key, entry) =>
    set((state) => {
      if (state.codexCreditOverage[key] === entry) return state;
      const codexCreditOverage = { ...state.codexCreditOverage };
      if (entry) {
        codexCreditOverage[key] = entry;
      } else {
        delete codexCreditOverage[key];
      }
      return { codexCreditOverage };
    }),
  setCodexCreditOverageOperation: (accountId, operation) =>
    set((state) => {
      const codexCreditOverageOperations = { ...state.codexCreditOverageOperations };
      if (operation) {
        codexCreditOverageOperations[accountId] = operation;
      } else {
        delete codexCreditOverageOperations[accountId];
      }
      return { codexCreditOverageOperations };
    }),
  clearCodexCreditOverageOperations: () => set({ codexCreditOverageOperations: {} }),
  setAntigravityQuota: (updater) =>
    set((state) => ({
      antigravityQuota: resolveUpdater(updater, state.antigravityQuota),
    })),
  setClaudeQuota: (updater) =>
    set((state) => {
      const next = resolveUpdater(updater, state.claudeQuota);
      let retained = next;
      for (const [key, quota] of Object.entries(next)) {
        const previous = state.claudeQuota[key];
        if (
          previous &&
          quota !== previous &&
          (quota.status === 'loading' || quota.status === 'error') &&
          !quota.observedAt &&
          (previous.observedAt ||
            previous.windows.length ||
            previous.extraUsage ||
            previous.dollarWindows?.length)
        ) {
          if (retained === next) retained = { ...next };
          retained[key] = {
            ...quota,
            windows: previous.windows,
            extraUsage: previous.extraUsage,
            dollarWindows: previous.dollarWindows,
            observedAt: previous.observedAt,
            planType: previous.planType,
            stale: quota.status === 'error' || previous.stale,
          };
        }
      }
      return { claudeQuota: retained };
    }),
  setCodexQuota: (updater) =>
    set((state) => ({
      codexQuota: resolveUpdater(updater, state.codexQuota),
    })),
  setKimiQuota: (updater) =>
    set((state) => ({
      kimiQuota: resolveUpdater(updater, state.kimiQuota),
    })),
  setMetaQuota: (updater) =>
    set((state) => ({
      metaQuota: resolveUpdater(updater, state.metaQuota),
    })),
  setQoderCNQuota: (updater) =>
    set((state) => ({
      qodercnQuota: resolveUpdater(updater, state.qodercnQuota),
    })),
  setXaiQuota: (updater) =>
    set((state) => ({
      xaiQuota: resolveUpdater(updater, state.xaiQuota),
    })),
  setDevinQuota: (updater) =>
    set((state) => ({
      devinQuota: resolveUpdater(updater, state.devinQuota),
    })),
  clearQuotaForFile: (name) =>
    set((state) => {
      const remove = <T>(values: Record<string, T>): Record<string, T> => {
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
        metaQuota: remove(state.metaQuota),
        qodercnQuota: remove(state.qodercnQuota),
        xaiQuota: remove(state.xaiQuota),
        devinQuota: remove(state.devinQuota),
        pluginQuota: Object.fromEntries(
          Object.entries(state.pluginQuota).filter(([key]) => key.split('\0')[0] !== name)
        ),
      };
    }),
  clearQuotaCache: (names) =>
    set((state) => {
      if (names && names.length > 0) {
        const fileGenerations = { ...state.fileGenerations };
        for (const name of names) {
          fileGenerations[name] = (fileGenerations[name] ?? 0) + 1;
        }
        const drop = <T>(values: Record<string, T>): Record<string, T> => {
          let next = values;
          for (const name of names) {
            if (!(name in next)) continue;
            if (next === values) next = { ...values };
            delete next[name];
          }
          return next;
        };
        return {
          fileGenerations,
          antigravityQuota: drop(state.antigravityQuota),
          claudeQuota: drop(state.claudeQuota),
          codexQuota: drop(state.codexQuota),
          kimiQuota: drop(state.kimiQuota),
          metaQuota: drop(state.metaQuota),
          qodercnQuota: drop(state.qodercnQuota),
          xaiQuota: drop(state.xaiQuota),
          devinQuota: drop(state.devinQuota),
          pluginQuota: Object.fromEntries(
            Object.entries(state.pluginQuota).filter(([key]) => !names.includes(key.split('\0')[0]))
          ),
        };
      }
      return {
        cacheGeneration: state.cacheGeneration + 1,
        fileGenerations: {},
        devinQuota: {},
        antigravityQuota: {},
        claudeQuota: {},
        codexQuota: {},
        codexCreditOverage: {},
        kimiQuota: {},
        metaQuota: {},
        qodercnQuota: {},
        xaiQuota: {},
        pluginQuota: {},
      };
    }),
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

export const commitIfQuotaCacheCurrent = (token: QuotaCacheToken, commit: () => void): boolean => {
  if (!isQuotaCacheCurrent(token)) return false;
  commit();
  return true;
};
