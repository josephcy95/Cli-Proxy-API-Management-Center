import { afterEach, describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import i18n from '../src/i18n';
import { commandCodeToResource } from '../src/features/providers/adapters';
import { PROVIDER_BRAND_ORDER, PROVIDER_DESCRIPTORS } from '../src/features/providers/descriptors';
import { PROVIDER_LOGOS } from '../src/features/providers/brandLogos';
import { ProviderCategoryList } from '../src/features/providers/components/ProviderCategoryList';
import { BaseProviderForm } from '../src/features/providers/sheets/forms/BaseProviderForm';
import { apiClient } from '../src/services/api/client';
import { providersApi } from '../src/services/api/providers';
import { normalizeConfigResponse } from '../src/services/api/transformers';

const originalGet = apiClient.get;
const originalPut = apiClient.put;
const originalDelete = apiClient.delete;

afterEach(() => {
  apiClient.get = originalGet;
  apiClient.put = originalPut;
  apiClient.delete = originalDelete;
});

describe('Command Code API key provider', () => {
  test('normalizes the backend commandcode-api-key contract and exposes a workbench resource', () => {
    const config = normalizeConfigResponse({
      'commandcode-api-key': [
        {
          'api-key': 'user_secret',
          priority: 7,
          weight: 5,
          prefix: 'cc',
          'base-url': 'https://api.commandcode.ai',
          'proxy-url': 'http://proxy.local',
          headers: { 'X-Custom': 'value' },
          models: [{ name: 'deepseek/deepseek-v4-flash', alias: 'cc-flash' }],
          'excluded-models': ['deepseek/deepseek-v4-pro'],
          'disable-cooling': true,
          'auth-index': 'commandcode:apikey:1',
        },
      ],
    });

    expect(config.commandcodeApiKeys).toEqual([
      {
        apiKey: 'user_secret',
        priority: 7,
        weight: 5,
        prefix: 'cc',
        baseUrl: 'https://api.commandcode.ai',
        proxyUrl: 'http://proxy.local',
        headers: { 'X-Custom': 'value' },
        models: [{ name: 'deepseek/deepseek-v4-flash', alias: 'cc-flash' }],
        excludedModels: ['deepseek/deepseek-v4-pro'],
        disableCooling: true,
        authIndex: 'commandcode:apikey:1',
      },
    ]);

    const resource = commandCodeToResource(config.commandcodeApiKeys![0], 0);
    expect(resource.brand).toBe('commandcode');
    expect(resource.baseUrl).toBe('https://api.commandcode.ai');
    expect(resource.models).toEqual(['deepseek/deepseek-v4-flash']);
    expect(resource.selector).toEqual({
      brand: 'commandcode',
      apiKey: 'user_secret',
      baseUrl: 'https://api.commandcode.ai',
      index: 0,
    });
  });

  test('descriptor exposes the Command Code contract and no Codex-only features', () => {
    const descriptor = PROVIDER_DESCRIPTORS.commandcode;
    expect(descriptor.supportsApiKey).toBe(true);
    expect(descriptor.supportsBaseUrl).toBe(true);
    // The base URL is optional: the backend defaults to https://api.commandcode.ai.
    expect(descriptor.baseUrlRequired).toBe(false);
    expect(descriptor.supportsModels).toBe(true);
    expect(descriptor.supportsHeaders).toBe(true);
    expect(descriptor.supportsExcludedModels).toBe(true);
    expect(descriptor.supportsProxyUrl).toBe(true);
    // Command Code has no OAuth flow, no websockets and no private instructions.
    expect(descriptor.supportsWebsockets).toBe(false);
    expect(descriptor.supportsCloak).toBe(false);
    expect(PROVIDER_LOGOS.commandcode.src.length).toBeGreaterThan(0);
    expect(PROVIDER_BRAND_ORDER).toContain('commandcode');
  });

  test('creates and deletes Command Code keys through the backend management contract', async () => {
    const calls: Array<{ method: string; url: string; data?: unknown }> = [];
    apiClient.get = (async (url: string) => {
      calls.push({ method: 'GET', url });
      return {
        'commandcode-api-key': [
          {
            'api-key': 'existing',
            'base-url': 'https://api.commandcode.ai',
            'future-field': 'preserved',
          },
        ],
      };
    }) as typeof apiClient.get;
    apiClient.put = (async (url: string, data?: unknown) => {
      calls.push({ method: 'PUT', url, data });
      return undefined;
    }) as typeof apiClient.put;
    apiClient.delete = (async (url: string) => {
      calls.push({ method: 'DELETE', url });
      return undefined;
    }) as typeof apiClient.delete;

    await providersApi.createCommandCodeConfig({
      apiKey: 'user_new',
      priority: 3,
      weight: 5,
      prefix: 'cc',
      baseUrl: 'https://api.commandcode.ai',
      proxyUrl: 'direct',
      headers: { 'X-Custom': 'value' },
      models: [{ name: 'deepseek/deepseek-v4-flash', alias: 'cc-flash' }],
      excludedModels: ['deepseek/deepseek-v4-pro'],
      disableCooling: true,
    });
    await providersApi.deleteCommandCodeConfig('user_new', 'https://api.commandcode.ai');

    expect(calls).toEqual([
      { method: 'GET', url: '/config' },
      {
        method: 'PUT',
        url: '/commandcode-api-key',
        data: [
          {
            'api-key': 'existing',
            'base-url': 'https://api.commandcode.ai',
            'future-field': 'preserved',
          },
          {
            'api-key': 'user_new',
            priority: 3,
            weight: 5,
            prefix: 'cc',
            'base-url': 'https://api.commandcode.ai',
            'proxy-url': 'direct',
            headers: { 'X-Custom': 'value' },
            models: [{ name: 'deepseek/deepseek-v4-flash', alias: 'cc-flash' }],
            'excluded-models': ['deepseek/deepseek-v4-pro'],
            'disable-cooling': true,
          },
        ],
      },
      {
        method: 'DELETE',
        url: '/commandcode-api-key?api-key=user_new&base-url=https%3A%2F%2Fapi.commandcode.ai',
      },
    ]);
  });

  test('renders the Command Code category and its create form without Codex-only fields', async () => {
    await i18n.changeLanguage('en');

    const categoryHtml = renderToStaticMarkup(
      createElement(ProviderCategoryList, {
        groups: [{ id: 'commandcode', resources: [] }],
        activeBrand: 'commandcode',
        onSelect: () => {},
      })
    );
    expect(categoryHtml).toContain('Command Code');
    expect(categoryHtml).toContain('commandcode.svg');

    const formHtml = renderToStaticMarkup(
      createElement(BaseProviderForm, {
        brand: 'commandcode',
        resource: null,
        mode: 'create',
        mutating: false,
        formId: 'commandcode-form',
        onSubmit: async () => {},
      })
    );
    // The Go-plan / higher-plan guidance is shown for this brand only.
    expect(formHtml).toContain('alpha/generate');
    expect(formHtml).toContain('https://api.commandcode.ai/provider/v1');
    expect(formHtml).toContain('69 models');
    // Excluded-models / headers / models editors are available ...
    expect(formHtml).toContain('Excluded models');
    expect(formHtml).toContain('Request headers');
    expect(formHtml).toContain('Custom models');
    // ... while Codex-only / OAuth-only surfaces are not.
    expect(formHtml).not.toContain('Enable WebSockets');
    expect(formHtml).not.toContain('Allow private instructions');
    expect(formHtml).not.toContain('Cloak settings');
    expect(formHtml).not.toContain('API key entries');
    expect(formHtml).not.toContain('Test model');

    await i18n.changeLanguage('zh-CN');
    const zhFormHtml = renderToStaticMarkup(
      createElement(BaseProviderForm, {
        brand: 'commandcode',
        resource: null,
        mode: 'create',
        mutating: false,
        formId: 'commandcode-form-zh',
        onSubmit: async () => {},
      })
    );
    expect(zhFormHtml).toContain('alpha/generate');
    expect(zhFormHtml).not.toContain('providersPage.');
    await i18n.changeLanguage('en');
  });

  test('updates a Command Code entry without leaking Codex-only fields', async () => {
    const calls: Array<{ method: string; url: string; data?: unknown }> = [];
    apiClient.get = (async (url: string) => {
      calls.push({ method: 'GET', url });
      return {
        'commandcode-api-key': [
          {
            'api-key': 'user_existing',
            'base-url': 'https://api.commandcode.ai',
            // Unknown future fields must survive a UI save.
            'future-field': 'preserved',
          },
        ],
      };
    }) as typeof apiClient.get;
    apiClient.put = (async (url: string, data?: unknown) => {
      calls.push({ method: 'PUT', url, data });
      return undefined;
    }) as typeof apiClient.put;

    await providersApi.updateCommandCodeConfig('user_existing', 'https://api.commandcode.ai', {
      apiKey: 'user_existing',
      baseUrl: 'https://api.commandcode.ai',
      // Even if a caller passes Codex-only flags, the known-field list strips them.
      websockets: true,
      allowPrivateInstructions: true,
    });

    expect(calls[1]).toEqual({
      method: 'PUT',
      url: '/commandcode-api-key',
      data: [
        {
          'api-key': 'user_existing',
          'base-url': 'https://api.commandcode.ai',
          'future-field': 'preserved',
        },
      ],
    });
  });
});
