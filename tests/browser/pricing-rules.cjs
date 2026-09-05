// With the UI dev server running on port 15173:
// PLAYWRIGHT_MODULE=/path/to/playwright-core CHROMIUM_PATH=/path/to/chrome node tests/browser/pricing-rules.cjs
// All Management API responses are synthetic; no live credentials or backend writes.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const assert = require('node:assert/strict');

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const original = {
      model: 'test-model', source: 'models.dev', source_model_id: 'provider/canonical',
      raw_json: '{"retained":true}', synced_at_ms: 1700000000000,
      prompt_per_1m: 2, completion_per_1m: 5,
      context_tiers: [{ threshold_tokens: 200000, prompt_configured: false, cache_read_configured: true }],
      service_tiers: [{ mode: 'fast', service_tier: 'priority', completion_per_1m: 10, completion_configured: true }],
    };
    const aliases = [{ alias: 'brand-model', target_model: 'test-model' }];
    const book = new Map([[original.model, original]]);
    const writes = [];
    const syncs = [];
    let aliasWrites = 0;
    const candidate = {
      ...original, model: 'canonical', source: 'litellm', source_model_id: 'same-id',
      prompt_per_1m: 3, raw_json: '{"selected":"litellm"}', synced_at_ms: 1710000000000,
      context_tiers: [{ threshold_tokens: 100000, prompt_per_1m: 0, prompt_configured: true }],
    };
    const pricesResponse = () => ({ prices: [...book.values()], aliases, unpriced_models: ['mapped-model'] });
    await page.route('**/v0/management/**', async route => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      let body = {};
      if (path.endsWith('/config.yaml')) return route.fulfill({ body: 'api-keys: []', contentType: 'text/yaml' });
      if (path.endsWith('/model-prices')) {
        if (request.method() === 'PUT') {
          const payload = request.postDataJSON();
          writes.push(payload);
          payload.prices.forEach(price => book.set(price.model, price));
        }
        body = pricesResponse();
      }
      if (path.endsWith('/model-price-aliases') && request.method() !== 'GET') aliasWrites++;
      if (path.endsWith('/model-prices/sync')) {
        syncs.push(request.postDataJSON());
        body = {
          ...pricesResponse(), imported: 0, skipped: 1, preserved: ['test-model'],
          sources: ['models.dev', 'litellm', 'openrouter'],
          candidates: [{ model: 'mapped-model', candidates: [
            { source_model_id: 'same-id', score: 0.9, reason: 'match', price: { ...candidate, source: 'models.dev', prompt_per_1m: 8 } },
            { source_model_id: 'same-id', score: 0.8, reason: 'match', price: candidate },
          ] }],
        };
      }
      if (path.endsWith('/usage-events')) body = { events: [] };
      if (path.endsWith('/usage-summary')) body = { usage_statistics_enabled: true, summary: { total_calls: 0 } };
      if (path.endsWith('/usage-filter-options')) body = { models: ['test-model'], providers: [], sources: [], api_keys: [], auth_indices: [], api_key_hashes: [] };
      if (path.endsWith('/usage-account-recent-requests')) body = { accounts: [] };
      await route.fulfill({ json: body });
    });
    await page.goto(`${process.env.UI_URL || 'http://127.0.0.1:15173'}/#/login`);
    await page.getByRole('textbox', { name: 'Management Key:' }).fill('synthetic-only');
    await page.getByRole('button', { name: 'Login', exact: true }).click();
    await page.getByRole('link', { name: 'Request Monitoring', exact: true }).click();
    await page.getByRole('tab', { name: 'Prices', exact: true }).click();
    const priceRow = model => page.locator('tbody tr').filter({ has: page.getByText(model, { exact: true }) }).first();
    await priceRow('test-model').waitFor();
    assert.equal(await page.getByText('Preserved prices:', { exact: false }).count(), 0, 'Preserved banner appeared before sync');
    const source = priceRow('test-model').getByText('models.dev', { exact: true });
    assert.match(await source.getAttribute('title'), /provider\/canonical/);
    assert.match(await source.getAttribute('title'), /Last synced:/);
    const chip = priceRow('test-model').getByText('Input > 200,000', { exact: true });
    assert.match(await chip.getAttribute('title'), /Prompt \/1M: 2\.00/);
    assert.match(await chip.getAttribute('title'), /Cache read \/1M: 0\.00/);

    await priceRow('test-model').getByRole('button', { name: 'Edit rules', exact: true }).click();
    const modal = page.getByRole('dialog');
    const context = modal.getByRole('group', { name: 'Context pricing 1', exact: true });
    const service = modal.getByRole('group', { name: 'Service-tier pricing 1', exact: true });
    assert.equal(await context.getByLabel('Prompt /1M', { exact: true }).inputValue(), '');
    assert.equal(await context.getByLabel('Cache read /1M', { exact: true }).inputValue(), '0');
    await context.getByLabel('Prompt /1M', { exact: true }).fill('0');
    await context.getByLabel('Cache read /1M', { exact: true }).fill('');
    await service.getByLabel('Completion /1M', { exact: true }).fill('');
    await service.getByLabel('Cache write /1M', { exact: true }).fill('0');
    await modal.getByRole('button', { name: 'Save rules', exact: true }).click();
    await modal.waitFor({ state: 'hidden' });
    const saved = writes[0].prices[0];
    assert.equal(saved.source, 'manual');
    assert.equal(saved.raw_json, original.raw_json);
    assert.equal(saved.source_model_id, original.source_model_id);
    assert.equal(saved.synced_at_ms, original.synced_at_ms);
    assert.equal(saved.context_tiers[0].prompt_configured, true);
    assert.equal(saved.context_tiers[0].prompt_per_1m, 0);
    assert.equal(saved.context_tiers[0].cache_read_configured, false);
    assert.equal(saved.context_tiers[0].cache_read_per_1m, undefined);
    assert.equal(saved.service_tiers[0].completion_configured, false);
    assert.equal(saved.service_tiers[0].cache_creation_configured, true);
    assert.equal(saved.service_tiers[0].cache_creation_per_1m, 0);
    assert.equal(writes[0].replace, false);

    await page.getByRole('button', { name: 'Sync prices', exact: true }).click();
    const select = page.getByRole('combobox', { name: 'Confirm model mapping', exact: true });
    await select.waitFor();
    assert.equal(syncs[0].override_manual, false);
    assert.equal(await page.getByText('Preserved prices: test-model', { exact: true }).count(), 1);
    await select.click();
    await page.getByRole('option', { name: /litellm · same-id/ }).click();
    await page.getByRole('button', { name: 'Apply mapping', exact: true }).click();
    await priceRow('mapped-model').waitFor();
    assert.deepEqual(writes[1].prices[0], { ...candidate, model: 'mapped-model' });

    await priceRow('test-model').getByRole('button', { name: 'Edit', exact: true }).click();
    await page.getByText(/Saving base rates clears the pricing rules for test-model/).waitFor();
    page.once('dialog', dialog => dialog.dismiss());
    await page.getByRole('button', { name: 'Save price', exact: true }).click();
    assert.equal(writes.length, 2, 'Cancel saved base rates');
    page.once('dialog', dialog => dialog.accept());
    const saveResponse = page.waitForResponse(response => response.url().endsWith('/model-prices') && response.request().method() === 'PUT');
    await page.getByRole('button', { name: 'Save price', exact: true }).click();
    await saveResponse;
    assert.deepEqual(writes[2].prices[0].context_tiers, []);
    assert.deepEqual(writes[2].prices[0].service_tiers, []);
    assert.deepEqual(book.get('mapped-model'), { ...candidate, model: 'mapped-model' });
    assert.equal(aliasWrites, 0);
    assert.equal(await page.getByText('brand-model', { exact: true }).count(), 1);
    assert.deepEqual(errors, []);
    await page.screenshot({ path: '/tmp/ui-pricing-smoke.png', fullPage: true });
    console.log('PASS: inherited vs zero rule editing, configured flags, source metadata, source-qualified candidate selection/full-price apply, default manual protection, post-sync preserved display, explicit rule-clear confirmation and aliases');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
