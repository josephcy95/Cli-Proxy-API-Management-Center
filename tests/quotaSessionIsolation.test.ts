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
