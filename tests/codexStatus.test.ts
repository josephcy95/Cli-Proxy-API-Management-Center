import { describe, expect, test } from 'bun:test';
import {
  compareCodexAvailability,
  compareCodexAdaptive,
  getCodexAccountStatus,
  isPurposefullyDisabled,
  matchesCodexPlanFilter,
  matchesCodexStatusFilter,
  type CodexRefreshState,
} from '@/features/authFiles/codexStatus';
import { resolveCodexPlanType } from '@/utils/quota';

const file = { name: 'codex.json', type: 'codex', plan_type: 'plus' };

describe('Codex auth-file status', () => {
  test('keeps internal other status out of visible filters while All includes it', () => {
    const other = { ...file, unavailable: true };

    expect(matchesCodexStatusFilter('all', other)).toBe(true);
    expect(matchesCodexStatusFilter('denied', other)).toBe(false);
  });

  test('compares availability by status, priority, and filename only', () => {
    const available = { ...file, name: 'zeta.json', priority: 1, plan_type: 'free' };
    const availableHigherPriority = {
      ...file,
      name: 'omega.json',
      priority: 9,
      plan_type: 'pro',
    };
    const other = { ...file, name: 'other.json', priority: 99 };
    const cooldown = { ...file, name: 'cooldown.json', priority: 99 };
    const denied = { ...file, name: 'denied.json', priority: 99 };

    expect(compareCodexAvailability(available, other, 'working', 'other')).toBeLessThan(0);
    expect(
      compareCodexAvailability(available, availableHigherPriority, 'working', 'working')
    ).toBeGreaterThan(0);
    expect(compareCodexAvailability(other, cooldown, 'other', 'cooldown')).toBeLessThan(0);
    expect(compareCodexAvailability(cooldown, denied, 'cooldown', 'denied')).toBeLessThan(0);
    expect(compareCodexAvailability(available, availableHigherPriority, 'working', 'working')).toBe(
      8
    );

    const alpha = { ...file, name: 'alpha.json', priority: 4 };
    const beta = { ...file, name: 'beta.json', priority: 4 };
    expect(compareCodexAvailability(alpha, beta, 'working', 'working')).toBeLessThan(0);
  });

  test('groups every known non-free plan under Paid', () => {
    expect(matchesCodexPlanFilter({ ...file, plan_type: 'free' }, 'paid')).toBe(false);
    expect(matchesCodexPlanFilter({ ...file, plan_type: 'plus' }, 'paid')).toBe(true);
    expect(matchesCodexPlanFilter({ ...file, plan_type: 'pro' }, 'paid')).toBe(true);
    expect(matchesCodexPlanFilter({ ...file, plan_type: 'mystery' }, 'paid')).toBe(false);
  });

  test('uses a refreshed plan ahead of the stored plan for filtering', () => {
    const refreshed: CodexRefreshState = {
      status: 'success',
      planType: 'pro',
      windows: [],
    };

    expect(matchesCodexPlanFilter(file, 'paid', refreshed)).toBe(true);
    expect(matchesCodexPlanFilter(file, 'free', refreshed)).toBe(false);
  });

  test('prefers stored plan_type over stale JWT plus claims', () => {
    const downgraded = {
      name: 'codex-josephcy95@gmail.com-plus.json',
      type: 'codex',
      plan_type: 'free',
      chatgpt_plan_type: 'free',
      id_token: {
        plan_type: 'plus',
        'https://api.openai.com/auth': { chatgpt_plan_type: 'plus' },
      },
    };

    expect(resolveCodexPlanType(downgraded)).toBe('free');
    expect(matchesCodexPlanFilter(downgraded, 'free')).toBe(true);
    expect(matchesCodexPlanFilter(downgraded, 'paid')).toBe(false);
  });

  test('falls back to chatgpt_plan_type then JWT plan', () => {
    expect(
      resolveCodexPlanType({
        name: 'a.json',
        type: 'codex',
        chatgpt_plan_type: 'team',
        id_token: { 'https://api.openai.com/auth': { chatgpt_plan_type: 'plus' } },
      })
    ).toBe('team');

    expect(
      resolveCodexPlanType({
        name: 'b.json',
        type: 'codex',
        id_token: { 'https://api.openai.com/auth': { chatgpt_plan_type: 'plus' } },
      })
    ).toBe('plus');
  });

  test('recognizes the K12 plan type', () => {
    const k12File = { ...file, plan_type: 'k12' };

    expect(matchesCodexPlanFilter(k12File, 'paid')).toBe(true);
  });

  test('classifies full quota windows as cooldown', () => {
    const refreshed: CodexRefreshState = {
      status: 'success',
      planType: 'plus',
      windows: [
        { id: 'five-hour', label: '5h', usedPercent: 100, resetLabel: 'later' },
        { id: 'weekly', label: 'Week', usedPercent: 30, resetLabel: 'later' },
      ],
    };

    const status = getCodexAccountStatus(file, refreshed);
    expect(status.kind).toBe('cooldown');
    expect(status.fiveHourLimited).toBe(true);
    expect(matchesCodexStatusFilter('cooldown', file, refreshed)).toBe(true);
    expect(matchesCodexStatusFilter('available', file, refreshed)).toBe(false);
  });

  test('does not classify quota refresh auth errors as denied', () => {
    const reauth: CodexRefreshState = {
      status: 'error',
      planType: null,
      windows: [],
      errorStatus: 401,
      error: 'unauthorized',
    };
    expect(getCodexAccountStatus(file, reauth).kind).toBe('other');
    expect(matchesCodexStatusFilter('denied', file, reauth)).toBe(false);

    const deactivated = {
      ...file,
      disabled: true,
      disabled_reason: 'workspace deactivated',
    };
    expect(getCodexAccountStatus(deactivated).kind).toBe('denied');

    const invalidToken = {
      ...file,
      disabled: true,
      disabled_reason: 'invalid_token',
      status_message: 'invalid_token',
    };
    expect(getCodexAccountStatus(invalidToken).kind).toBe('denied');
  });

  test('treats usage_limit_reached as cooldown not denied', () => {
    const refreshed: CodexRefreshState = {
      status: 'error',
      planType: 'free',
      windows: [],
      error: JSON.stringify({
        error: { type: 'usage_limit_reached', message: 'The usage limit has been reached' },
      }),
    };
    expect(getCodexAccountStatus(file, refreshed).kind).toBe('cooldown');
  });

  test('classifies healthy enabled files as working', () => {
    const refreshed: CodexRefreshState = {
      status: 'success',
      planType: 'plus',
      windows: [{ id: 'five-hour', label: '5h', usedPercent: 40, resetLabel: 'later' }],
    };
    expect(getCodexAccountStatus(file, refreshed).kind).toBe('working');
    expect(matchesCodexStatusFilter('available', file, refreshed)).toBe(true);
  });

  test('counts manually disabled accounts without a failure reason as working', () => {
    // Management toggle disable writes no disabled_reason; the credential is parked on purpose.
    const parked = {
      ...file,
      disabled: true,
      status_message: 'disabled via management API',
    };
    expect(isPurposefullyDisabled(parked)).toBe(true);
    expect(getCodexAccountStatus(parked).kind).toBe('working');
    expect(matchesCodexStatusFilter('available', parked)).toBe(true);
  });

  test('treats legacy manual disables without a status marker as working', () => {
    const parked = { ...file, disabled: true };

    expect(isPurposefullyDisabled(parked)).toBe(true);
    expect(getCodexAccountStatus(parked).kind).toBe('working');
    expect(matchesCodexStatusFilter('available', parked)).toBe(true);
  });

  test('keeps manual disables working through non-auth refresh errors', () => {
    const parked = { ...file, disabled: true };
    const refreshError: CodexRefreshState = {
      status: 'error',
      planType: null,
      windows: [],
      error: 'temporary quota service unavailable',
      errorStatus: 503,
    };

    expect(getCodexAccountStatus(parked, refreshError).kind).toBe('working');
    expect(
      getCodexAccountStatus(parked, { ...refreshError, error: 'invalid token', errorStatus: 401 })
        .kind
    ).toBe('working');
  });

  test('keeps auto-disabled accounts out of the working filter', () => {
    const denied = {
      ...file,
      disabled: true,
      disabled_reason: 'invalid_token: token has been invalidated',
    };
    expect(isPurposefullyDisabled(denied)).toBe(false);
    expect(getCodexAccountStatus(denied).kind).toBe('denied');
    expect(matchesCodexStatusFilter('available', denied)).toBe(false);

    const exhausted = {
      ...file,
      disabled: true,
      disabled_reason: 'Codex auth failure (counter=2, threshold=2)',
      status_message: 'Codex auth failure',
    };
    expect(getCodexAccountStatus(exhausted).kind).toBe('denied');
    expect(matchesCodexStatusFilter('available', exhausted)).toBe(false);
  });

  test('manual disable does not hide quota exhaustion', () => {
    const refreshed: CodexRefreshState = {
      status: 'success',
      planType: 'plus',
      windows: [{ id: 'five-hour', label: '5h', usedPercent: 100, resetLabel: 'later' }],
    };
    const parked = { ...file, disabled: true };
    expect(getCodexAccountStatus(parked, refreshed).kind).toBe('cooldown');
    expect(matchesCodexStatusFilter('available', parked, refreshed)).toBe(false);
  });
});

test('classifies persisted limit flags as cooldown', () => {
  const flagged = {
    ...file,
    'X-Codex-Primary-Limit-Reached': 'true',
    'X-Codex-Primary-Reset-After-Seconds': '3600',
    codex_quota_observed_at: new Date().toISOString(),
  };

  expect(getCodexAccountStatus(flagged).kind).toBe('cooldown');
});

test('classifies both persisted quota windows by their durations', () => {
  const permuted = {
    ...file,
    'X-Codex-Primary-Used-Percent': 70,
    'X-Codex-Primary-Window-Minutes': 10080,
    'X-Codex-Secondary-Used-Percent': 100,
    'X-Codex-Secondary-Window-Minutes': 300,
    'X-Codex-Secondary-Reset-After-Seconds': 3600,
    codex_quota_observed_at: new Date().toISOString(),
  };

  expect(getCodexAccountStatus(permuted).kind).toBe('cooldown');
});

test('keeps persisted windows when a live response only contains a partial snapshot', () => {
  const persisted = {
    ...file,
    'X-Codex-Primary-Used-Percent': 100,
    'X-Codex-Primary-Window-Minutes': 300,
    'X-Codex-Primary-Reset-After-Seconds': 3600,
    codex_quota_observed_at: new Date().toISOString(),
  };
  const refreshed: CodexRefreshState = {
    status: 'success',
    planType: 'plus',
    windows: [{ id: 'weekly', label: 'Week', usedPercent: 30, resetLabel: 'later' }],
  };

  expect(getCodexAccountStatus(persisted, refreshed).kind).toBe('cooldown');
});

test('adaptive sorting uses the persisted weekly window', () => {
  const mostlyUsed = {
    ...file,
    name: 'mostly-used.json',
    'X-Codex-Secondary-Used-Percent': 90,
    'X-Codex-Secondary-Window-Minutes': 10080,
  };
  const mostlyAvailable = {
    ...file,
    name: 'mostly-available.json',
    'X-Codex-Secondary-Used-Percent': 10,
    'X-Codex-Secondary-Window-Minutes': 10080,
  };

  expect(compareCodexAdaptive(mostlyUsed, mostlyAvailable)).toBeGreaterThan(0);
});

test('adaptive sorting does not use the five-hour reset as the weekly ranking deadline', () => {
  const now = Date.parse('2026-09-01T00:00:00Z');
  const fiveHourOnly = {
    ...file,
    name: 'five-hour-only.json',
    chatgpt_subscription_active_until: '2026-09-06T00:00:00Z',
    'X-Codex-Primary-Used-Percent': 20,
    'X-Codex-Primary-Window-Minutes': 300,
    'X-Codex-Primary-Reset-After-Seconds': 3600,
  };
  const earlierExpiry = {
    ...file,
    name: 'earlier-expiry.json',
    chatgpt_subscription_active_until: '2026-09-03T00:00:00Z',
    'X-Codex-Secondary-Used-Percent': 20,
    'X-Codex-Secondary-Window-Minutes': 10080,
  };

  expect(compareCodexAdaptive(fiveHourOnly, earlierExpiry, now)).toBeGreaterThan(0);
});

test('adaptive sorting excludes active unavailable and quota-limited accounts', () => {
  const now = Date.parse('2026-09-01T00:00:00Z');
  const cooldown = {
    ...file,
    name: 'socialwisp.json',
    chatgpt_subscription_active_until: '2026-09-03T10:00:00Z',
    rate_limit_reset_credits_available_count: 1,
    'quota': {
      observed_at: '2026-09-01T00:00:00Z',
      signals: {
        'X-Codex-Primary-Used-Percent': '100',
        'X-Codex-Primary-Window-Minutes': '300',
        'X-Codex-Primary-Reset-After-Seconds': '7200',
      },
    },
  };
  const sounder = {
    ...file,
    name: 'sounder.json',
    chatgpt_subscription_active_until: '2026-09-03T11:00:00Z',
    'X-Codex-Secondary-Used-Percent': 20,
    'X-Codex-Secondary-Window-Minutes': 10080,
  };
  const lido = {
    ...file,
    name: 'lido.json',
    chatgpt_subscription_active_until: '2026-09-03T23:00:00Z',
    'X-Codex-Secondary-Used-Percent': 20,
    'X-Codex-Secondary-Window-Minutes': 10080,
  };

  expect(compareCodexAdaptive(cooldown, sounder, now)).toBeGreaterThan(0);
  expect(compareCodexAdaptive(sounder, lido, now)).toBeLessThan(0);
});

test('adaptive sorting reads persisted quota signals from the management observation payload', () => {
  const now = Date.parse('2026-09-01T00:00:00Z');
  const nested = {
    ...file,
    name: 'nested.json',
    quota: {
      observed_at: '2026-09-01T00:00:00Z',
      signals: {
        'X-Codex-Primary-Used-Percent': '100',
        'X-Codex-Primary-Window-Minutes': '300',
        'X-Codex-Primary-Reset-After-Seconds': '7200',
      },
    },
  };

  expect(getCodexAccountStatus(nested, undefined, now).kind).toBe('cooldown');
});

test('adaptive sorting prefers the earliest usable expiry over a later account with more quota', () => {
  const now = Date.parse('2026-09-01T00:00:00Z');
  const urgent = {
    ...file,
    name: 'sounder.json',
    chatgpt_subscription_active_until: '2026-09-03T11:00:00Z',
    'X-Codex-Secondary-Used-Percent': 20,
    'X-Codex-Secondary-Window-Minutes': 10080,
  };
  const laterWithReset = {
    ...file,
    name: 'five-days-reset.json',
    chatgpt_subscription_active_until: '2026-09-06T00:00:00Z',
    rate_limit_reset_credits_available_count: 1,
    rate_limit_reset_credits: [
      { status: 'available', expires_at: '2026-09-06T00:00:00Z' },
    ],
    'X-Codex-Secondary-Used-Percent': 0,
    'X-Codex-Secondary-Window-Minutes': 10080,
  };

  expect(compareCodexAdaptive(urgent, laterWithReset, now)).toBeLessThan(0);
});

test('adaptive sorting does not let a stale backend rank override the visible expiry', () => {
  const now = Date.parse('2026-09-01T00:00:00Z');
  const staleRankFirst = {
    ...file,
    name: 'nineteen-days.json',
    chatgpt_subscription_active_until: '2026-09-20T19:00:00Z',
    'X-Codex-Secondary-Used-Percent': 4,
    'X-Codex-Secondary-Window-Minutes': 10080,
    codex_adaptive: { candidate: true, rank: 1 },
  };
  const actuallyUrgent = {
    ...file,
    name: 'joseph.json',
    chatgpt_subscription_active_until: '2026-09-06T11:00:00Z',
    'X-Codex-Secondary-Used-Percent': 36,
    'X-Codex-Secondary-Window-Minutes': 10080,
    codex_adaptive: { candidate: true, rank: 5 },
  };

  expect(compareCodexAdaptive(staleRankFirst, actuallyUrgent, now)).toBeGreaterThan(0);
});

test('adaptive sorting keeps a live cooldown behind a usable backend candidate', () => {
  const now = Date.parse('2026-09-01T00:00:00Z');
  const cooldown = {
    ...file,
    name: 'cooldown.json',
    codex_adaptive: { candidate: true, rank: 1 },
    chatgpt_subscription_active_until: '2026-09-03T00:00:00Z',
  };
  const usable = {
    ...file,
    name: 'usable.json',
    codex_adaptive: { candidate: true, rank: 2 },
    chatgpt_subscription_active_until: '2026-09-04T00:00:00Z',
  };
  const refreshed: CodexRefreshState = {
    status: 'success',
    planType: 'plus',
    windows: [{ id: 'five-hour', label: '5h', usedPercent: 100, resetLabel: 'later' }],
  };

  expect(compareCodexAdaptive(cooldown, usable, now, refreshed)).toBeGreaterThan(0);
});

test('adaptive sorting uses live quota windows when calculating fallback urgency', () => {
  const now = Date.parse('2026-09-01T00:00:00Z');
  const refreshed: CodexRefreshState = {
    status: 'success',
    planType: 'plus',
    windows: [{ id: 'weekly', label: 'Week', usedPercent: 95, resetLabel: 'later' }],
  };
  const liveNearlyEmpty = {
    ...file,
    name: 'live-nearly-empty.json',
    chatgpt_subscription_active_until: '2026-09-03T00:00:00Z',
  };
  const liveFull = {
    ...file,
    name: 'live-full.json',
    chatgpt_subscription_active_until: '2026-09-04T00:00:00Z',
  };

  expect(compareCodexAdaptive(liveNearlyEmpty, liveFull, now, refreshed)).toBeLessThan(0);
});

test('adaptive sorting reads reset-credit summaries nested in quota data', () => {
  const nested = {
    ...file,
    quota: {
      observed_at: '2026-08-31T00:00:00Z',
      rate_limit_reset_credits: {
        available_count: 1,
        applicable_available_count: 1,
      },
    },
  };

  expect(compareCodexAdaptive(nested, file)).toBeLessThanOrEqual(0);
});
