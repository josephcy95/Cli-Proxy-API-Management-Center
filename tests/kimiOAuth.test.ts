import { describe, expect, spyOn, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import i18n from '@/i18n';
import { OAuthPage } from '@/pages/OAuthPage';
import { apiClient } from '@/services/api/client';
import { oauthApi } from '@/services/api/oauth';
import { createOAuthAttempts } from '@/pages/oauthAttempts';

describe('Kimi regional login', () => {
  test('uses separate management endpoints and preserves cancellation', async () => {
    const get = spyOn(apiClient, 'get').mockResolvedValue({ url: 'https://example.test' });
    const controller = new AbortController();
    try {
      await oauthApi.startAuth('kimi', controller.signal);
      expect(get).toHaveBeenLastCalledWith('/kimi-auth-url', {
        params: undefined,
        signal: controller.signal,
      });
      await oauthApi.startAuth('kimi-ai', controller.signal);
      expect(get).toHaveBeenLastCalledWith('/kimi-ai-auth-url', {
        params: undefined,
        signal: controller.signal,
      });
    } finally {
      get.mockRestore();
    }
  });

  test('keeps regional login attempts independent', () => {
    const attempts = createOAuthAttempts({ setTimeout: () => 0, clearTimeout: () => {} });
    try {
      const china = attempts.begin('kimi');
      const international = attempts.begin('kimi-ai');
      attempts.begin('kimi-ai');
      expect(china.signal.aborted).toBe(false);
      expect(international.signal.aborted).toBe(true);
    } finally {
      attempts.invalidateAll();
    }
  });

  test('keeps both Kimi regions on one card', () => {
    const source = readFileSync('src/pages/OAuthPage.tsx', 'utf8');
    expect(source).toContain("id: 'kimi-ai'");
    expect(source).toContain("id: 'kimi'");
    expect(source).toContain("id: 'qoder'");
    expect(source).toContain("id: 'qodercn'");
    expect(source).toContain('auth_login.login_international');
    expect(source).toContain('auth_login.login_china');
    expect(source).not.toContain('featuredCard');
  });

  test('paints one Kimi card and one Qoder card with two region buttons', async () => {
    await i18n.changeLanguage('en');
    const html = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(OAuthPage)));
    const kimi = html.indexOf('>Kimi<');
    const codex = html.indexOf('Codex OAuth');
    const qoder = html.indexOf('>Qoder<');
    const international = html.indexOf('Intl version');
    const china = html.indexOf('China version');
    expect(kimi).toBeGreaterThan(-1);
    expect(international).toBeGreaterThan(kimi);
    expect(china).toBeGreaterThan(international);
    expect(codex).toBeGreaterThan(china);
    expect(qoder).toBeGreaterThan(codex);
    expect(html.indexOf('Intl version', international + 1)).toBeGreaterThan(qoder);
    expect(html.indexOf('China version', china + 1)).toBeGreaterThan(qoder);
    expect(html).not.toContain('Kimi China (kimi.com)');
    expect(html).not.toContain('Qoder CN OAuth');
    expect(html).not.toContain('Sign Up Now');
  });

  for (const locale of ['en', 'zh-CN']) {
    test(`provides complete regional login translations (${locale})`, () => {
      const { auth_login: messages } = JSON.parse(
        readFileSync(`src/i18n/locales/${locale}.json`, 'utf8')
      ) as { auth_login: Record<string, string> };
      for (const key of Object.keys(messages).filter((key) => key.startsWith('kimi_'))) {
        if (
          key.startsWith('kimi_ai_') ||
          key.startsWith('kimi_region_') ||
          key === 'kimi_sign_up_button'
        ) {
          continue;
        }
        expect(messages[key.replace('kimi_', 'kimi_ai_')]).toBeTruthy();
      }
      expect(messages.kimi_oauth_title).toContain('kimi.com');
      expect(messages.kimi_ai_oauth_title).toContain('kimi.ai');
    });
  }
});
