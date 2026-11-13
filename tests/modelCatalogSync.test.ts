import { describe, expect, spyOn, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { modelsApi } from '../src/services/api/models';
import { apiClient } from '../src/services/api/client';

const read = (path: string) => readFileSync(path, 'utf8');
const hook = read('src/features/authFiles/hooks/useModelCatalogSync.ts');

function harness() {
  let revision = 1;
  let resolve!: (value: { changedProviders: string[] }) => void;
  let reject!: (error: Error) => void;
  let calls = 0;
  let invalidations = 0;
  let refetches = 0;
  let loading = false;
  const notifications: unknown[][] = [];
  const mountedRef = { current: true };
  const env = {
    useCallback: (fn: unknown) => fn,
    pendingRef: { current: false },
    mountedRef,
    apiClient: { getConnectionRevision: () => revision },
    useAuthStore: { getState: () => ({ connectionStatus: 'connected' }) },
    modelsApi: {
      refreshCatalog: () => {
        calls++;
        return new Promise((res, rej) => {
          resolve = res;
          reject = rej;
        });
      },
    },
    useModelsStore: { getState: () => ({ clearCache: () => invalidations++ }) },
    onSyncedRef: { current: () => refetches++ },
    setSyncingModelCatalog: (value: boolean) => {
      loading = value;
    },
    showNotification: (...args: unknown[]) => notifications.push(args),
    t: (key: string, params?: { providers: string }) => `${key}${params?.providers ?? ''}`,
  };
  const block = hook.slice(hook.indexOf('  const syncModelCatalog ='), hook.indexOf('  return {'));
  const js = ts.transpileModule(`${block}\nreturn syncModelCatalog;`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return {
    sync: new Function(...Object.keys(env), js)(...Object.values(env)) as () => Promise<void>,
    resolve: (providers: string[]) => resolve({ changedProviders: providers }),
    reject: () => reject(new Error('fixture failure')),
    switchConnection: () => revision++,
    unmount: () => {
      mountedRef.current = false;
    },
    notifications,
    get calls() {
      return calls;
    },
    get invalidations() {
      return invalidations;
    },
    get refetches() {
      return refetches;
    },
    get loading() {
      return loading;
    },
  };
}

describe('global model catalog sync', () => {
  test('uses the backend v8 catalog refresh route and normalizes null providers', async () => {
    apiClient.setConfig({ apiBase: 'https://catalog-fixture.invalid', managementKey: 'fixture' });
    const urls: string[] = [];
    let providers: string[] | null = null;
    const transport = spyOn(apiClient, 'captureConnection');
    const originalCapture = transport.getMockImplementation();
    // Exercise the captured Axios client so the test proves the versioned route.
    transport.mockImplementation((version) => {
      const captured = originalCapture!.call(apiClient, version);
      const instance = (captured as unknown as { instance: { defaults: { adapter: unknown } } })
        .instance;
      instance.defaults.adapter = async (config: { url: string; baseURL?: string }) => {
        urls.push(`${config.baseURL ?? ''}${config.url}`);
        return {
          data: { changed_providers: providers },
          status: 200,
          statusText: 'OK',
          headers: {},
          config,
        };
      };
      return captured;
    });
    try {
      expect(await modelsApi.refreshCatalog()).toEqual({ changedProviders: [] });
      providers = ['claude'];
      expect(await modelsApi.refreshCatalog()).toEqual({ changedProviders: ['claude'] });
      expect(urls).toEqual(
        Array(2).fill('https://catalog-fixture.invalid/v8/management/models/refresh')
      );
    } finally {
      transport.mockRestore();
    }
  });

  for (const providers of [[], ['claude', 'codex']]) {
    test(`invalidates and refetches even when unchanged: ${providers}`, async () => {
      const h = harness();
      const pending = h.sync();
      await h.sync();
      expect(h.calls).toBe(1);
      expect(h.loading).toBe(true);
      h.resolve(providers);
      await pending;
      expect(h.loading).toBe(false);
      expect(h.invalidations).toBe(1);
      expect(h.refetches).toBe(1);
      expect(h.notifications[0]).toEqual([
        providers.length
          ? 'auth_files.sync_catalog_successclaude, codex'
          : 'auth_files.sync_catalog_unchanged',
        'success',
      ]);
    });
  }

  test('reports errors without clearing valid caches and allows retry', async () => {
    const h = harness();
    const pending = h.sync();
    h.reject();
    await pending;
    expect(h.notifications[0]).toEqual([
      'auth_files.sync_catalog_failed: fixture failure',
      'error',
    ]);
    expect(h.invalidations).toBe(0);
    expect(h.loading).toBe(false);
    const retry = h.sync();
    h.resolve([]);
    await retry;
    expect(h.calls).toBe(2);
  });

  for (const stale of ['switchConnection', 'unmount'] as const) {
    for (const fail of [false, true]) {
      test(`ignores stale ${fail ? 'error' : 'success'} after ${stale}`, async () => {
        const h = harness();
        const pending = h.sync();
        h[stale]();
        if (fail) h.reject();
        else h.resolve(['claude']);
        await pending;
        expect(h.notifications).toEqual([]);
        expect(h.invalidations).toBe(0);
        expect(h.refetches).toBe(0);
      });
    }
  }

  test('wires model-only cache refresh into the consolidated fork page', () => {
    const page = read('src/pages/AuthFilesPage.tsx');
    expect(page).toContain('useModelCatalogSync(() =>');
    expect(page).toContain('invalidateModels()');
    expect(page).toContain('setModelCatalogVersion');
    expect(page).toContain('void showModels(');
    for (const locale of ['en', 'zh-CN']) {
      const messages = JSON.parse(read(`src/i18n/locales/${locale}.json`)).auth_files;
      for (const key of ['button', 'success', 'unchanged', 'failed'])
        expect(messages[`sync_catalog_${key}`]).toBeTruthy();
      expect(messages.sync_catalog_success).toContain('{{providers}}');
    }
  });
});
