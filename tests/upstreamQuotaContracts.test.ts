import { afterEach, describe, expect, test } from 'bun:test';
import { parseDocument } from 'yaml';
import { runVisualConfig } from './helpers/visualConfig';
import { buildClaudeQuotaWindows, CODEX_CONFIG } from '@/components/quota/quotaConfigs';
import { apiClient } from '@/services/api/client';
import { apiCallApi } from '@/services/api/apiCall';
import { authFilesApi } from '@/services/api/authFiles';
import { fetchPluginQuota } from '@/services/api/pluginQuota';
import { useQuotaStore } from '@/stores/useQuotaStore';
import { getQuotaCacheKey, isPluginQuotaFile } from '@/utils/quota';

const originalGet = apiClient.get;
const originalPost = apiClient.post;
const originalRequest = apiCallApi.request;
const originalReset = authFilesApi.resetQuota;
const originalRevision = apiClient.getConnectionRevision;
const t = ((key: string) => key) as never;

afterEach(() => {
  apiClient.get = originalGet;
  apiClient.post = originalPost;
  apiCallApi.request = originalRequest;
  authFilesApi.resetQuota = originalReset;
  apiClient.getConnectionRevision = originalRevision;
  useQuotaStore.getState().clearQuotaCache();
});

describe('upstream contracts preserve fork behavior', () => {
  test('global GitHub token round-trips in canonical YAML without dropping fork configuration', () => {
    const yaml =
      'server: {github-token: old}\nupstream: {codex: {instructions: {content: private}}}\nfuture: retained\n';
    const config = runVisualConfig(yaml, [{ githubToken: 'new' }]);
    const result = parseDocument(config.applyVisualChangesToYaml(yaml)).toJS();
    expect(result.server['github-token']).toBe('new');
    expect(result.upstream.codex.instructions.content).toBe('private');
    expect(result.future).toBe('retained');
    expect(runVisualConfig(yaml).visualValues.githubToken).toBe('old');
  });

  test('Claude scoped limits survive alongside dollar-denominated cloud credits', () => {
    const windows = buildClaudeQuotaWindows(
      {
        limits: [
          { kind: 'weekly_scoped', percent: 8, scope: { model: { display_name: 'Fable' } } },
        ],
        iguana_necktie: { utilization: 20, resets_at: '', limit_dollars: 25 },
      },
      t
    );
    expect(windows.map((window) => window.label)).toEqual([
      'Fable',
      'claude_quota.cloud_session_credits',
    ]);
    expect(windows.map((window) => window.usedPercent)).toEqual([8, 20]);
  });

  test('dedicated fork providers take precedence over generic plugin quota capability', () => {
    for (const provider of ['codex', 'qoder', 'qodercn']) {
      expect(isPluginQuotaFile({ name: 'auth.json', provider, supportsQuota: true })).toBe(false);
    }
    expect(
      isPluginQuotaFile({ name: 'auth.json', provider: 'custom', supports_quota: 'true' })
    ).toBe(true);
  });

  test('plugin quota fetch uses advertised plugin ID and exact credential index', async () => {
    let request: unknown;
    apiClient.post = (async (path, body) => {
      request = { path, body };
      return { groups: [], summary: [{ key: 'balance', label: 'Balance', value: 5 }] };
    }) as typeof apiClient.post;
    const result = await fetchPluginQuota(
      {
        name: 'multi.json',
        provider: 'custom',
        auth_index: 'two',
        quota_provider: 'custom',
        quota_plugin_id: 'quota-plugin',
      },
      t
    );
    expect(request).toEqual({ path: '/plugins/quota-plugin/quota', body: { auth_index: 'two' } });
    expect(result.summary[0].value).toBe(5);
  });

  test('unmapped providers and declarative probes use the fork credential route', async () => {
    let request: unknown;
    apiClient.post = (async (path, body) => {
      request = { path, body };
      return { groups: [], summary: [] };
    }) as typeof apiClient.post;
    for (const provider of ['', 'unmapped']) {
      await fetchPluginQuota(
        { name: 'probe.json', auth_index: 'probe', supports_quota: true, quota_provider: provider },
        t
      );
    }
    expect(request).toEqual({ path: '/quota/fetch', body: { auth_index: 'probe' } });
  });

  test('auth-file listing and cache invalidation preserve separate plugin credentials', async () => {
    const files = ['one', 'two'].map((authIndex) => ({
      name: 'multi.json',
      provider: 'custom',
      supports_quota: true,
      auth_index: authIndex,
    }));
    apiClient.get = (async () => ({ files })) as typeof apiClient.get;
    expect((await authFilesApi.list()).files).toHaveLength(2);
    const keys = files.map(getQuotaCacheKey);
    expect(new Set(keys).size).toBe(2);
    useQuotaStore
      .getState()
      .setPluginQuota(
        Object.fromEntries(keys.map((key) => [key, { status: 'success', groups: [], summary: [] }]))
      );
    useQuotaStore.getState().clearQuotaForFile('multi.json');
    expect(useQuotaStore.getState().pluginQuota).toEqual({});
  });

  test('unconfirmed Codex redemption never resets local cooldown', async () => {
    let resetCalled = false;
    apiCallApi.request = (async () => ({
      statusCode: 200,
      body: { code: 'pending' },
    })) as typeof apiCallApi.request;
    authFilesApi.resetQuota = async () => {
      resetCalled = true;
      return { status: 'ok', auth_index: 'one' };
    };
    await expect(
      CODEX_CONFIG.resetQuota!({ name: 'codex.json', auth_index: 'one' }, t)
    ).rejects.toThrow('codex_quota.reset_not_confirmed');
    expect(resetCalled).toBe(false);
  });

  test('Codex redemption cannot reset cooldown through a changed connection', async () => {
    let revision = 1;
    let resetCalled = false;
    apiClient.getConnectionRevision = () => revision;
    apiCallApi.request = (async () => {
      revision++;
      return { statusCode: 200, body: { code: 'reset' } };
    }) as typeof apiCallApi.request;
    authFilesApi.resetQuota = async () => {
      resetCalled = true;
      return { status: 'ok', auth_index: 'one' };
    };
    await expect(
      CODEX_CONFIG.resetQuota!({ name: 'codex.json', auth_index: 'one' }, t)
    ).rejects.toThrow('codex_quota.reset_cooldown_failed');
    expect(resetCalled).toBe(false);
  });
});
