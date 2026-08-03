import { describe, expect, test } from 'bun:test';
import {
  buildInteractionsEndpoint,
  buildInteractionsProbePayload,
  INTERACTIONS_API_REVISION,
} from '@/components/providers/utils';
import { interactionsToResource } from '@/features/providers/adapters';
import { parseRoutingStrategy } from '@/hooks/useVisualConfig';
import { normalizeConfigResponse } from '@/services/api/transformers';
import {
  MAX_CREDENTIAL_WEIGHT,
  readCredentialWeight,
  validateCredentialWeightText,
} from '@/utils/credentialWeight';
import { normalizeCodexResetCreditsPayload } from '@/utils/quota/resetCredits';

describe('adapted upstream functionality', () => {
  test('recognizes weighted routing aliases and credential weights', () => {
    expect(parseRoutingStrategy('wrr')).toBe('weighted-round-robin');
    expect(parseRoutingStrategy('fillfirst')).toBe('fill-first');
    expect(readCredentialWeight('25')).toBe(25);
    expect(validateCredentialWeightText('1.5')).toBe('integer');
    expect(validateCredentialWeightText(String(MAX_CREDENTIAL_WEIGHT + 1))).toBe('max');
  });

  test('normalizes Interactions API credentials into the existing provider workbench', () => {
    const config = normalizeConfigResponse({
      'interactions-api-key': [
        {
          'api-key': 'gemini-interactions-key',
          weight: 4,
          'base-url': 'https://generativelanguage.googleapis.com',
        },
      ],
    });
    expect(config.interactionsApiKeys?.[0]?.weight).toBe(4);
    expect(interactionsToResource(config.interactionsApiKeys![0], 0).brand).toBe('interactions');
    expect(buildInteractionsEndpoint('https://generativelanguage.googleapis.com/v1beta')).toBe(
      'https://generativelanguage.googleapis.com/v1beta/interactions'
    );
    expect(buildInteractionsProbePayload('gemini-2.5-pro')).toEqual({
      model: 'gemini-2.5-pro',
      input: 'Hi',
    });
    expect(INTERACTIONS_API_REVISION).toBe('2026-05-20');
  });

  test('uses applicable Codex reset credits when the backend supplies them', () => {
    expect(
      normalizeCodexResetCreditsPayload({
        available_count: 3,
        applicable_available_count: 1,
        credits: [],
      })
    ).toMatchObject({
      availableCount: 3,
      applicableAvailableCount: 1,
      invalidPayload: false,
    });
  });
});
