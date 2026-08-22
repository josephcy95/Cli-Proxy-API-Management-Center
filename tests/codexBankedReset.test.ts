import { afterEach, describe, expect, test } from 'bun:test';
import type { TFunction } from 'i18next';
import { CODEX_CONFIG } from '@/components/quota/quotaConfigs';
import { apiCallApi, authFilesApi, type ApiCallResult } from '@/services/api';
import {
  CODEX_RATE_LIMIT_RESET_CREDITS_CONSUME_URL,
  CODEX_RATE_LIMIT_RESET_CREDITS_URL,
  CODEX_USAGE_URL,
} from '@/utils/quota';

const t = ((key: string) => key) as unknown as TFunction;
const originalApiCallRequest = apiCallApi.request;
const originalResetQuota = authFilesApi.resetQuota;

const ok = (body: unknown = {}): ApiCallResult => ({
  statusCode: 200,
  header: {},
  bodyText: JSON.stringify(body),
  body,
});

describe('Codex banked quota reset', () => {
  afterEach(() => {
    apiCallApi.request = originalApiCallRequest;
    authFilesApi.resetQuota = originalResetQuota;
  });

  test('clears local cooldown after consuming the reset credit', async () => {
    const calls: string[] = [];
    apiCallApi.request = async (request) => {
      calls.push(request.url);
      return ok();
    };
    authFilesApi.resetQuota = async (authIndex) => {
      calls.push(`reset:${authIndex}`);
      return { status: 'ok', auth_index: authIndex, models: [] };
    };

    await CODEX_CONFIG.resetQuota?.(
      { name: 'codex.json', type: 'codex', auth_index: 'codex:account-1' },
      t
    );

    expect(calls).toEqual([
      CODEX_RATE_LIMIT_RESET_CREDITS_CONSUME_URL,
      'reset:codex:account-1',
      CODEX_USAGE_URL,
      CODEX_RATE_LIMIT_RESET_CREDITS_URL,
    ]);
  });
});
