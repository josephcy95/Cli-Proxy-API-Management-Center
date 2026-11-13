import { beforeEach, describe, expect, test } from 'bun:test';
import {
  captureQuotaCacheGeneration,
  commitIfQuotaCacheCurrent,
  useQuotaStore,
} from '../src/stores/useQuotaStore';

describe('quota cache session isolation', () => {
  beforeEach(() => {
    useQuotaStore.getState().clearQuotaCache();
  });

  test('full reset clears every provider snapshot but preserves unresolved credit writes', () => {
    const keys = [
      'antigravityQuota',
      'claudeQuota',
      'codexQuota',
      'devinQuota',
      'kimiQuota',
      'metaQuota',
      'qodercnQuota',
      'xaiQuota',
      'pluginQuota',
    ] as const;
    const snapshots = Object.fromEntries(
      keys.map((key) => [key, { 'old-session.json': { status: 'loading' } }])
    );
    useQuotaStore.setState(snapshots);
    useQuotaStore
      .getState()
      .setCodexCreditOverageOperation('account', { status: 'unconfirmed', target: true, at: 1 });
    useQuotaStore.getState().clearQuotaCache();
    for (const key of keys) expect(useQuotaStore.getState()[key]).toEqual({});
    expect(useQuotaStore.getState().codexCreditOverageOperations.account).toEqual({
      status: 'unconfirmed',
      target: true,
      at: 1,
    });
    useQuotaStore.getState().clearCodexCreditOverageOperations();
    expect(useQuotaStore.getState().codexCreditOverageOperations).toEqual({});
  });

  test('prevents an earlier connection from committing after the cache is cleared', () => {
    const previousConnection = captureQuotaCacheGeneration();
    let committed = false;

    useQuotaStore.getState().clearQuotaCache();

    expect(
      commitIfQuotaCacheCurrent(previousConnection, () => {
        committed = true;
      })
    ).toBe(false);
    expect(committed).toBe(false);
  });

  test('allows the current connection generation to commit', () => {
    const currentConnection = captureQuotaCacheGeneration();
    let committed = false;

    expect(
      commitIfQuotaCacheCurrent(currentConnection, () => {
        committed = true;
      })
    ).toBe(true);
    expect(committed).toBe(true);
  });

  test('invalidating one file does not cancel another file request', () => {
    const firstFile = captureQuotaCacheGeneration('first.json');
    const secondFile = captureQuotaCacheGeneration('second.json');

    useQuotaStore.getState().clearQuotaForFile('first.json');

    expect(commitIfQuotaCacheCurrent(firstFile, () => {})).toBe(false);
    expect(commitIfQuotaCacheCurrent(secondFile, () => {})).toBe(true);
  });
});
