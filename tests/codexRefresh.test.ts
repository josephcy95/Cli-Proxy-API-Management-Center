import { afterEach, describe, expect, test } from 'bun:test';
import type { TFunction } from 'i18next';
import { fetchCodexQuota } from '@/components/quota/quotaConfigs';
import {
  canRefreshCodexData,
  listCodexRefreshableFiles,
} from '@/features/authFiles/codexRefresh';
import { apiCallApi, type ApiCallResult } from '@/services/api';
import type { AuthFileItem } from '@/types';
import {
  CODEX_RATE_LIMIT_RESET_CREDITS_URL,
  CODEX_USAGE_URL,
  codexQuotaPersistInputFromData,
} from '@/utils/quota';

const baseFile = (overrides: Partial<AuthFileItem> = {}): AuthFileItem => ({
  name: 'codex.json',
  type: 'codex',
  auth_index: 'idx-1',
  disabled: false,
  ...overrides,
});

describe('Codex filtered refresh targets', () => {
  test('includes disabled Codex files that are still in the current filter', () => {
    expect(canRefreshCodexData(baseFile({ disabled: true }))).toBe(true);
  });

  test('skips runtime-only files, missing auth_index, and non-Codex providers', () => {
    expect(canRefreshCodexData(baseFile({ runtimeOnly: true }))).toBe(false);
    expect(canRefreshCodexData(baseFile({ auth_index: '', authIndex: null }))).toBe(false);
    expect(canRefreshCodexData(baseFile({ type: 'claude' }))).toBe(false);
  });

  test('uses the filtered list rather than every Codex credential', () => {
    const filtered = [
      baseFile({ name: 'cooldown.json', auth_index: 'a' }),
      baseFile({ name: 'disabled.json', auth_index: 'b', disabled: true }),
      baseFile({ name: 'runtime.json', auth_index: 'c', runtimeOnly: true }),
      baseFile({ name: 'no-index.json', auth_index: '', authIndex: null }),
    ];
    expect(listCodexRefreshableFiles(filtered).map((file) => file.name)).toEqual([
      'cooldown.json',
      'disabled.json',
    ]);
  });
});

const t = ((key: string) => key) as unknown as TFunction;
const originalApiCallRequest = apiCallApi.request;

const ok = (body: unknown = {}): ApiCallResult => ({
  statusCode: 200,
  header: {},
  bodyText: JSON.stringify(body),
  body,
});

describe('Codex quota fetch for filtered refresh', () => {
  afterEach(() => {
    apiCallApi.request = originalApiCallRequest;
  });

  test('reads usage windows and the latest reset-credits list', async () => {
    const calls: string[] = [];
    apiCallApi.request = async (request) => {
      calls.push(request.url);
      if (request.url === CODEX_USAGE_URL) {
        return ok({
          plan_type: 'plus',
          rate_limit: {
            primary_window: { used_percent: 10, limit_window_seconds: 18000 },
            secondary_window: { used_percent: 20, limit_window_seconds: 604800 },
          },
        });
      }
      if (request.url === CODEX_RATE_LIMIT_RESET_CREDITS_URL) {
        return ok({
          available_count: 1,
          applicable_available_count: 1,
          credits: [
            {
              id: 'credit-1',
              status: 'available',
              reset_type: 'codex_rate_limits',
              granted_at: '2026-08-01T00:00:00Z',
              expires_at: '2026-09-01T04:00:00Z',
            },
          ],
        });
      }
      return ok();
    };

    const snapshot = await fetchCodexQuota(baseFile(), t);

    expect(calls).toEqual([CODEX_USAGE_URL, CODEX_RATE_LIMIT_RESET_CREDITS_URL]);
    expect(snapshot.planType).toBe('plus');
    expect(snapshot.rateLimitResetCreditsAvailableCount).toBe(1);
    expect(snapshot.rateLimitResetCredits).toEqual([
      {
        id: 'credit-1',
        status: 'available',
        grantedAt: '2026-08-01T00:00:00Z',
        expiresAt: '2026-09-01T04:00:00Z',
      },
    ]);
    expect(snapshot.rateLimitResetCreditsError).toBe('');
    expect(codexQuotaPersistInputFromData(snapshot).resetCreditsFetched).toBe(true);
  });
});
