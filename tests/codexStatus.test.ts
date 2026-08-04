import { describe, expect, test } from 'bun:test';
import {
  getCodexAccountStatus,
  getCodexPlanSortRank,
  isPurposefullyDisabled,
  matchesCodexPlanFilter,
  matchesCodexStatusFilter,
  type CodexRefreshState,
} from '@/features/authFiles/codexStatus';
import { resolveCodexPlanType } from '@/utils/quota';

const file = { name: 'codex.json', type: 'codex', plan_type: 'plus' };

describe('Codex auth-file status', () => {
  test('uses a refreshed plan ahead of the stored plan for filtering and sorting', () => {
    const refreshed: CodexRefreshState = {
      status: 'success',
      planType: 'pro',
      windows: [],
    };

    expect(matchesCodexPlanFilter(file, 'pro', refreshed)).toBe(true);
    expect(matchesCodexPlanFilter(file, 'plus', refreshed)).toBe(false);
    expect(getCodexPlanSortRank(file, refreshed)).toBe(50);
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
    expect(matchesCodexPlanFilter(downgraded, 'plus')).toBe(false);
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

    expect(matchesCodexPlanFilter(k12File, 'k12')).toBe(true);
    expect(getCodexPlanSortRank(k12File)).toBe(10);
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
    expect(matchesCodexStatusFilter('working', file, refreshed)).toBe(false);
  });

  test('classifies 401 and invalid-token messages as denied', () => {
    const reauth: CodexRefreshState = {
      status: 'error',
      planType: null,
      windows: [],
      errorStatus: 401,
      error: 'unauthorized',
    };
    expect(getCodexAccountStatus(file, reauth).kind).toBe('denied');
    expect(matchesCodexStatusFilter('denied', file, reauth)).toBe(true);

    const deactivated = {
      ...file,
      disabled_reason: 'workspace deactivated',
    };
    expect(getCodexAccountStatus(deactivated).kind).toBe('denied');

    const invalidToken = {
      ...file,
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
    expect(matchesCodexStatusFilter('working', file, refreshed)).toBe(true);
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
    expect(matchesCodexStatusFilter('working', parked)).toBe(true);
  });

  test('keeps auto-disabled accounts out of the working filter', () => {
    const denied = {
      ...file,
      disabled: true,
      disabled_reason: 'invalid_token: token has been invalidated',
    };
    expect(isPurposefullyDisabled(denied)).toBe(false);
    expect(getCodexAccountStatus(denied).kind).toBe('denied');
    expect(matchesCodexStatusFilter('working', denied)).toBe(false);

    const exhausted = {
      ...file,
      disabled: true,
      disabled_reason: 'Codex auth failure (counter=2, threshold=2)',
    };
    expect(getCodexAccountStatus(exhausted).kind).toBe('other');
    expect(matchesCodexStatusFilter('working', exhausted)).toBe(false);
  });

  test('manual disable does not hide quota exhaustion', () => {
    const refreshed: CodexRefreshState = {
      status: 'success',
      planType: 'plus',
      windows: [{ id: 'five-hour', label: '5h', usedPercent: 100, resetLabel: 'later' }],
    };
    const parked = { ...file, disabled: true };
    expect(getCodexAccountStatus(parked, refreshed).kind).toBe('cooldown');
    expect(matchesCodexStatusFilter('working', parked, refreshed)).toBe(false);
  });
});
