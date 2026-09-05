// Start bun run dev --host 127.0.0.1 --port 15173, then:
// PLAYWRIGHT_MODULE=/path/to/playwright-core node tests/browser/monitoring-refresh.cjs
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const assert = require('node:assert/strict');
(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    let requests = 0;
    let delay = 0;
    await page.route('**/v0/management/**', async route => {
      const path = new URL(route.request().url()).pathname;
      let body = {};
      if (path.endsWith('/config.yaml')) return route.fulfill({ body: 'api-keys: []', contentType: 'text/yaml' });
      if (path.endsWith('/usage-events')) { requests++; body = { events: [{ id: 1, timestamp_ms: Date.now(), source: 'demo', provider: 'codex', model: 'test-model', input_tokens: 10, output_tokens: 2, total_tokens: 12, failed: false }] }; }
      if (path.endsWith('/usage-summary')) body = { usage_statistics_enabled: true, summary: { total_calls: 1, success_rate: 1, total_tokens: 12 } };
      if (path.endsWith('/usage-filter-options')) body = { models: ['test-model'], providers: ['codex'], sources: ['demo'], api_keys: [], auth_indices: [], api_key_hashes: [] };
      if (path.endsWith('/usage-account-recent-requests')) body = { accounts: [] };
      if (path.includes('/usage-')) await new Promise(r => setTimeout(r, delay));
      await route.fulfill({ json: body }).catch(() => {});
    });
    await page.goto('http://127.0.0.1:15173/#/login');
    await page.getByRole('textbox', { name: 'Management Key:' }).fill('synthetic-only');
    await page.getByRole('button', { name: 'Login', exact: true }).click();
    await page.getByRole('link', { name: 'Request Monitoring', exact: true }).click();
    await page.waitForSelector('tbody tr');
    await page.waitForTimeout(200);
    const toggle = page.getByRole('button', { name: 'Live updates', exact: true });
    assert.equal(await toggle.innerText(), 'Live');
    const row = page.locator('tbody tr').first();
    const before = await row.boundingBox();
    delay = 700;
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    await page.waitForTimeout(200);
    assert.equal(await page.locator('tbody tr').count(), 1, 'Refresh cleared existing rows');
    assert.equal((await row.boundingBox()).y, before.y, 'Refresh shifted table');
    assert.equal(await page.locator('[class*="sectionStatus"], [class*="rangeDescription"]').count(), 0);
    await page.waitForTimeout(900);
    assert.equal((await row.boundingBox()).y, before.y);
    const width = (await toggle.boundingBox()).width;
    await toggle.click();
    assert.equal(await toggle.innerText(), 'Paused');
    assert.equal((await toggle.boundingBox()).width, width);
    const count = requests;
    await page.waitForTimeout(5300);
    assert.equal(requests, count, 'Paused polling continued');
    await toggle.click();
    await page.waitForTimeout(5500);
    assert.ok(requests > count, 'Live polling did not resume');
    await page.getByRole('button', { name: 'Custom…', exact: true }).click();
    await page.getByRole('button', { name: 'Apply', exact: true }).click();
    assert.equal(await toggle.innerText(), 'Paused');
    assert.equal(await toggle.isDisabled(), true);
    await page.waitForTimeout(1600);
    await page.screenshot({ path: '/tmp/monitoring-live-toolbar.png' });
    console.log('PASS: stable refresh layout, retained rows, Live/Paused toggle, polling, custom pause, no banners');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
