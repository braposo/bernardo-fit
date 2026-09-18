import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const server = createServer(async (req, res) => {
  if (!['/', '/index.html'].includes(new URL(req.url, 'http://localhost').pathname)) { res.writeHead(404).end(); return; }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(await readFile(new URL('./index.html', import.meta.url)));
});
const serve = process.argv.includes('--serve');
await new Promise(resolve => server.listen(serve ? 4177 : 0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
if (serve) console.log(`Mockup preview: ${origin}`);
else {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    for (const [view, width, height, name] of [
      ['pipeline', 1440, 1080, '01-pipeline.png'],
      ['role', 1440, 1050, '02-role-documents.png'],
      ['pipeline', 390, 1180, '03-mobile.png'],
      ['role', 390, 1180, '04-mobile-documents.png'],
    ]) {
      await page.setViewportSize({ width, height });
      await page.goto(origin + '/?capture&view=' + view);
      await page.evaluate(() => document.fonts.ready);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `No overflow: ${view} ${width}`);
      await page.screenshot({ path: fileURLToPath(new URL(name, import.meta.url)), fullPage: true });
      console.log(`Rendered ${name}`);
    }
    await page.setViewportSize({ width: 1440, height: 1080 });
    await page.goto(origin + '/?view=pipeline');
    await page.locator('[data-job="linear"]').click();
    assert.ok(await page.locator('.reading-pane h1').textContent().then(s => s.includes('Product Platform')));
    assert.equal(await page.locator('[data-job="linear"]').getAttribute('aria-pressed'), 'true');
    assert.ok(await page.locator('.job-pane').isVisible());
    assert.equal(await page.locator('.listing-bar a').getAttribute('href'), 'https://example.com/jobs/linear');
    assert.equal(await page.locator('.listing-bar a').getAttribute('target'), '_blank');
    await page.locator('[data-job="sanity"]').focus();
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('[data-job="sanity"]').getAttribute('aria-pressed'), 'true');
    await page.locator('#search').fill('Linear');
    assert.equal(await page.locator('.job-card').count(), 1);
    await page.locator('#search').fill('');
    await page.locator('#filter').selectOption('Interviewing');
    assert.equal(await page.locator('.job-card').count(), 1);
    await page.locator('[data-job="sanity"]').first().click();
    assert.equal(await page.locator('.document-card').count(), 4);
    await page.locator('[data-doc="Cover letter"]').click();
    assert.ok(await page.locator('dialog').isVisible());
    await page.keyboard.press('Escape');
    await page.setViewportSize({ width: 390, height: 1180 });
    await page.locator('.focus-back').click();
    assert.ok(await page.locator('.job-pane').isVisible());
    await page.locator('[data-job="linear"]').click();
    assert.ok(await page.locator('.reading-pane').isVisible());
    assert.equal(await page.locator('.job-pane').isVisible(), false);
    assert.equal(errors.length, 0, errors.join('\n'));
    console.log('Mockup navigation, filtering, document preview and responsive checks passed.');
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}
