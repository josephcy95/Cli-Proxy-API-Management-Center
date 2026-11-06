import { describe, expect, test } from 'bun:test';
import axios, { AxiosError, type AxiosResponse } from 'axios';
import { apiClient } from '@/services/api/client';
import { captureSiwcBindingApi } from '@/services/api/oauth';
import { obfuscatedStorage } from '@/services/storage/secureStorage';
import { deobfuscateData, obfuscateData } from '@/utils/encryption';
import { normalizeClaudeUsageSnapshot } from '@/services/api/claudeUsage';
import { parseKimiPlanName } from '@/services/api/kimiQuota';

describe('upstream integration regressions', () => {
  test('SIWC pins the complete v8 exchange to the original gateway and key', async () => {
    const originalAdapter = axios.defaults.adapter;
    const calls: {
      base: string | undefined;
      path: string | undefined;
      key: unknown;
      data: unknown;
    }[] = [];
    axios.defaults.adapter = async (config) => {
      calls.push({
        base: config.baseURL,
        path: config.url,
        key: config.headers.Authorization,
        data: config.data,
      });
      return { config, data: { status: 'wait' }, status: 200, statusText: 'OK', headers: {} };
    };
    try {
      apiClient.setConfig({ apiBase: 'https://a.invalid/gateway', managementKey: 'fixture-a' });
      const api = captureSiwcBindingApi();
      apiClient.setConfig({ apiBase: 'https://b.invalid', managementKey: 'fixture-b' });
      const signal = new AbortController().signal;
      await api.start('codex.json');
      await api.submitCallback(
        'http://127.0.0.1:1455/auth/callback?state=s&code=c&client_id=d',
        signal
      );
      await api.getStatus('s', signal);
      await api.cancel('s');
      expect(calls.map((call) => call.path)).toEqual([
        '/oauth/siwc/bind',
        '/oauth/callback',
        '/oauth/status',
        '/oauth/session',
      ]);
      expect(
        calls.every(
          (call) =>
            call.base === 'https://a.invalid/gateway/v8/management' &&
            call.key === 'Bearer fixture-a'
        )
      ).toBe(true);
      expect(JSON.parse(calls[0].data as string)).toEqual({ name: 'codex.json' });
      expect(JSON.parse(calls[1].data as string)).toMatchObject({ provider: 'codex' });
    } finally {
      axios.defaults.adapter = originalAdapter;
      apiClient.setConfig({ apiBase: '', managementKey: '' });
    }
  });

  for (const status of [200, 401]) {
    test(`SIWC ignores old server events across an ABA connection change (${status})`, async () => {
      const originalAdapter = axios.defaults.adapter;
      const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
      const events: string[] = [];
      Object.defineProperty(globalThis, 'window', {
        configurable: true,
        value: { dispatchEvent: (event: Event) => events.push(event.type) },
      });
      let deliver!: () => void;
      let dispatched!: () => void;
      const started = new Promise<void>((resolve) => {
        dispatched = resolve;
      });
      axios.defaults.adapter = (config) =>
        new Promise<AxiosResponse>((resolve, reject) => {
          deliver = () => {
            const response = {
              config,
              data: { status: 'ok' },
              status,
              statusText: String(status),
              headers: { 'X-CPA-Version': 'old', 'X-CPA-Support-Plugin': 'true' },
            };
            if (status === 401)
              reject(
                new AxiosError('Unauthorized', 'ERR_BAD_REQUEST', config, undefined, response)
              );
            else resolve(response);
          };
          dispatched();
        });
      try {
        apiClient.setConfig({ apiBase: 'https://a.invalid', managementKey: 'fixture-a' });
        const api = captureSiwcBindingApi();
        const pending = api.getStatus('old-state', new AbortController().signal);
        await started;
        apiClient.setConfig({ apiBase: 'https://b.invalid', managementKey: 'fixture-b' });
        apiClient.setConfig({ apiBase: 'https://a.invalid', managementKey: 'fixture-a' });
        deliver();
        if (status === 401) await expect(pending).rejects.toHaveProperty('status', 401);
        else await pending;
        expect(events).toEqual([]);
      } finally {
        axios.defaults.adapter = originalAdapter;
        apiClient.setConfig({ apiBase: '', managementKey: '' });
        if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
        else Reflect.deleteProperty(globalThis, 'window');
      }
    });
  }

  for (const writable of [true, false]) {
    test(`legacy remembered credentials remain readable when migration writable=${writable}`, () => {
      const originals = ['window', 'navigator', 'localStorage'].map(
        (key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const
      );
      const host = 'fixture.invalid';
      const userAgent = 'fixture-user-agent';
      const value = {
        state: { managementKey: 'fixture-only', rememberPassword: true },
        version: 0,
      };
      const bytes = new TextEncoder().encode(JSON.stringify(value));
      const key = new TextEncoder().encode(
        `cli-proxy-api-webui::secure-storage|${host}|${userAgent}`
      );
      const legacy =
        'enc::v1::' +
        btoa(String.fromCharCode(...bytes.map((byte, index) => byte ^ key[index % key.length])));
      let stored = legacy;
      Object.defineProperty(globalThis, 'window', {
        configurable: true,
        value: { location: { host } },
      });
      Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { userAgent } });
      Object.defineProperty(globalThis, 'localStorage', {
        configurable: true,
        value: {
          getItem: () => stored,
          setItem: (_key: string, next: string) => {
            if (!writable) throw new Error('storage full');
            stored = next;
          },
        },
      });
      try {
        expect(obfuscatedStorage.getItem('auth')).toEqual(value);
        expect(stored.startsWith(writable ? 'enc::v2::' : 'enc::v1::')).toBe(true);
        const current = obfuscateData(JSON.stringify(value));
        Object.defineProperty(globalThis, 'navigator', {
          configurable: true,
          value: { userAgent: 'updated-browser' },
        });
        expect(JSON.parse(deobfuscateData(current))).toEqual(value);
      } finally {
        for (const [key, descriptor] of originals) {
          if (descriptor) Object.defineProperty(globalThis, key, descriptor);
          else Reflect.deleteProperty(globalThis, key);
        }
      }
    });
  }

  test('quota normalization preserves zero, unknown balances, and official plan names', () => {
    const snapshot = normalizeClaudeUsageSnapshot({
      five_hour: { utilization: 0, resets_at: null },
      iguana_necktie: {
        limit_dollars: 20,
        used_dollars: 0,
        remaining_dollars: null,
        utilization: 0,
        resets_at: null,
      },
      extra_usage: { is_enabled: false, used_credits: 0, currency: 'EUR' },
    });
    expect(snapshot?.fiveHour?.utilization).toBe(0);
    expect(snapshot?.dollarWindows[0]).toMatchObject({ usedDollars: 0, remainingDollars: null });
    expect(snapshot?.extraUsage).toMatchObject({
      isEnabled: false,
      usedCredits: 0,
      monthlyLimit: null,
      currency: 'EUR',
    });
    expect(parseKimiPlanName({ user_id: 'fixture', user_level_name: ' Official plan ' })).toBe(
      'Official plan'
    );
    expect(parseKimiPlanName({ user_level_name: 'untrusted', quota: 100 })).toBe(null);
  });
});
