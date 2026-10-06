// Regression check for the retired combined CV + cover-letter document mode.
// The standalone CV remains a single-page print document; cover letters have
// their own independent reader and template.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { createSiteHandler } from '../api/site.js';

let cv, letter;
const handler = createSiteHandler(() => ({ fetch: async () => ({ title: 'Example CV', cv: {
  name: 'Example Candidate', headline: 'Engineer', contacts: [],
  sections: [{ label: 'Profile', items: [{ kind: 'text', body: [{ _type: 'block', children: [{ text: 'A sample public biography.', marks: [] }] }] }] }],
} }) }));
const response = () => ({ setHeader() {}, status(code) { assert.equal(code, 200); return this; }, send(html) { this.html = html; return html; } });
for (const page of ['cv', 'letter']) {
  const res = response();
  await handler({ method: 'GET', query: { page } }, res);
  if (page === 'cv') cv = res.html; else letter = res.html;
}
assert.ok(cv && letter, 'both standalone pages render');
assert.ok(!cv.includes('letter-page') && !cv.includes('SANITY_LETTER_HEADER'), 'CV template has no combined letter page');
assert.ok(letter.includes('Cover Letter') && letter.includes('<main class="page"') && !letter.includes('<!-- SANITY_LETTER_HEADER -->'), 'standalone cover letter page renders its own header and document');

const server = createServer((req, res) => {
  if (req.url.startsWith('/cv')) { res.setHeader('Content-Type', 'text/html'); res.end(cv); return; }
  res.statusCode = 404; res.end();
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ headless: true });
try {
  const origin = `http://127.0.0.1:${server.address().port}`;
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(`${origin}/cv?combined=1&j=sample&t=valid`);
  assert.equal(await page.locator('main.page').count(), 1, 'combined query leaves one CV page');
  assert.equal(await page.locator('#letter-page').count(), 0, 'combined query cannot reveal a letter');
  assert.equal(await page.locator('#print').isEnabled(), true);
  const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
  assert.equal((pdf.toString('latin1').match(/\/Type\s*\/Page\b/g) || []).length, 1, 'CV remains one A4 page');
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.locator('#page').isVisible(), true, 'CV reflows on mobile');
  console.log('Retired combined CV/letter mode: CV print and standalone letter template passed.');
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
