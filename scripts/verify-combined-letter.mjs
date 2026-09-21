import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('../', import.meta.url));
const cv = await readFile(path.join(root, 'public/cv.html'));
const fixture = {
  company: 'Example Company', salutation: 'Dear Hiring Team,',
  paragraphs: [
    { lead: true, html: 'I am interested in this role because it combines <em>engineering leadership</em> and product work.' },
    { html: 'I have led web platforms and customer-facing AI products across distributed teams.' },
  ],
};
const server = createServer((req, res) => {
  if (req.url.startsWith('/api/letter')) {
    const url = new URL(req.url, 'http://localhost');
    const valid = url.searchParams.get('t') === 'valid';
    res.setHeader('Content-Type', 'application/json');
    res.statusCode = valid ? 200 : 401;
    res.end(JSON.stringify(valid ? fixture : { error: 'This link has expired.' }));
    return;
  }
  if (req.url.startsWith('/api/track')) { res.end('{}'); return; }
  if (req.url.startsWith('/cv')) { res.setHeader('Content-Type', 'text/html'); res.end(cv); return; }
  res.statusCode = 404;
  res.end();
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ headless: true });
try {
  const origin = `http://127.0.0.1:${server.address().port}`;
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(`${origin}/cv`);
  const cvOnly = await page.pdf({ preferCSSPageSize: true, printBackground: true });
  assert.equal((cvOnly.toString('latin1').match(/\/Type\s*\/Page\b/g) || []).length, 1);
  await page.goto(`${origin}/cv?combined=1&j=sample&t=valid`);
  await page.locator('#letter-page:not([hidden])').waitFor();
  assert.equal(await page.locator('main.page').count(), 2);
  assert.equal(await page.locator('#page .label').first().textContent(), 'Profile');
  assert.match(await page.locator('#letter').textContent(), /Dear Hiring Team/);
  assert.match(await page.locator('#letter').textContent(), /engineering leadership/);
  assert.equal(await page.locator('#print').isEnabled(), true);
  await page.screenshot({ path: path.join(tmpdir(), 'combined-letter-desktop.png'), fullPage: true });
  const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
  await writeFile(path.join(tmpdir(), 'combined-letter-verification.pdf'), pdf);
  const pages = pdf.toString('latin1').match(/\/Type\s*\/Page\b/g) || [];
  assert.equal(pages.length, 2, `expected exactly two A4 PDF pages, got ${pages.length}`);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: path.join(tmpdir(), 'combined-letter-mobile.png'), fullPage: true });
  assert.equal(await page.locator('#letter-page').isVisible(), true);
  assert.equal(await page.locator('.printbar .what').textContent(), 'A4 · two pages · CV then cover letter · print with headers off');

  await page.goto(`${origin}/cv?combined=1&j=sample&t=expired`);
  await page.locator('.printbar .what').getByText('This link has expired.').waitFor();
  assert.equal(await page.locator('#letter-page').isVisible(), false);
  assert.equal(await page.locator('#print').isEnabled(), false);
  console.log('Combined CV and letter: page order, two-page PDF, mobile view, and expired link passed.');
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
