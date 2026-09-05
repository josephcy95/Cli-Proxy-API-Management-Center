// Against an already logged-in, synthetic-data monitoring page:
// playwright-cli -s=monitoring run-code --filename=tests/browser/monitoring-smoke.js
async (page) => {
  const check = (condition, message) => { if (!condition) throw new Error(message); };
  const seen = [];
  const onRequest = (request) => {
    if (request.method() === 'POST' && request.url().includes('/usage-'))
      seen.push({ path: new URL(request.url()).pathname, body: request.postDataJSON() });
  };
  page.on('request', onRequest);
  const custom = page.getByRole('button', { name: 'Custom…', exact: true });
  await custom.click();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  check(await page.getByRole('button', { name: '24h', exact: true }).getAttribute('aria-pressed') === 'true', 'Cancel changed range');
  await custom.click();
  const local = ms => {
    const d = new Date(ms); const pad = v => String(v).padStart(2,'0');
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  };
  const end = local(Date.now()); const start = local(Date.now()-86400000);
  await page.getByLabel('Start', { exact: true }).fill(end);
  await page.getByLabel('End', { exact: true }).fill(start);
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  check(await page.getByText('Enter valid dates and times, with Start earlier than End.').isVisible(), 'Reversed range accepted');
  await page.getByLabel('Start', { exact: true }).fill(start);
  await page.getByLabel('End', { exact: true }).fill(end);
  seen.length = 0;
  await Promise.all([page.waitForResponse(r => r.url().endsWith('/usage-summary') && r.status() === 200), page.getByRole('button', { name: 'Apply', exact: true }).click()]);
  await page.waitForTimeout(500);
  check(seen.filter(r=>r.path.endsWith('/usage-events')).length===1, 'Duplicate event load');
  check(seen.filter(r=>r.path.endsWith('/usage-account-stats')).length===0, 'Request list loaded full account stats');
  const range = seen.find(r=>r.path.endsWith('/usage-events')).body;
  check(range.from_ms===new Date(start).getTime() && range.to_ms===new Date(end).getTime(), 'Incorrect custom boundaries');
  const count = seen.length;
  await page.waitForTimeout(5300);
  check(seen.length===count, 'Custom range kept polling');
  await Promise.all([page.waitForResponse(r => r.url().endsWith('/usage-summary') && r.status()===200), page.getByRole('button', { name: 'Refresh', exact: true }).click()]);
  await page.waitForTimeout(300);
  const refreshed = seen.filter(r=>r.path.endsWith('/usage-events')).at(-1).body;
  check(refreshed.from_ms===range.from_ms && refreshed.to_ms===range.to_ms, 'Manual refresh moved custom bounds');
  seen.length=0;
  await Promise.all([page.waitForResponse(r=>r.url().endsWith('/usage-account-stats')), page.getByRole('tab', { name: 'Accounts', exact: true }).click()]);
  await page.waitForTimeout(300);
  check(seen.filter(r=>r.path.endsWith('/usage-account-stats')).length===1, 'Duplicate account load');
  check(!seen.some(r=>r.path.endsWith('/usage-summary') || r.path.endsWith('/usage-filter-options')), 'Tab change repeated summary/facets');
  // A delayed summary must not block events; obsolete requests must be aborted.
  await page.getByRole('tab', { name: /Real/ }).click();
  await page.route('**/usage-summary', async route => { await new Promise(r=>setTimeout(r,1500)); await route.continue().catch(()=>{}); });
  await Promise.all([page.waitForResponse(r=>r.url().endsWith('/usage-events')), page.getByRole('button', { name: '30d', exact: true }).click()]);
  await page.waitForTimeout(150);
  check(await page.locator('tbody tr').count()>0, 'Events waited for summary');
  const search=page.getByPlaceholder(/Search/).first();
  await search.fill('obsolete-query');
  await page.waitForTimeout(350);
  await search.fill('test-model');
  await page.waitForTimeout(2000);
  check(await page.locator('tbody tr').count()>0, 'Obsolete search overwrote current rows');
  await page.unroute('**/usage-summary');
  page.off('request',onRequest);
  console.log('PASS: custom bounds, validation, pause/manual refresh, no duplicate tabs, independent events and latest-search results');
}
