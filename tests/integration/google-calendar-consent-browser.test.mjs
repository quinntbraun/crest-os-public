import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { createServer } from 'node:https';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import AxeBuilder from '@axe-core/playwright';
import { chromium, expect, webkit } from '@playwright/test';
import { build } from 'rolldown';
import { googleCalendarInitialConsentPreview } from '../../src/operations/google-calendar-initial-consent.ts';
import { browserTestTls } from '../support/browser-test-tls.mjs';

const context = {
  destinationId: 'aabb0000-0101-4000-a900-000000000001',
  credentialId: 'aabb0000-0101-4000-a900-000000000002',
  recoveryEpoch: 'aabb0000-0101-4000-a900-000000000003',
};
const reviewId = 'aabb0000-0101-4000-a900-000000000004', consentId = 'aabb0000-0101-4000-a900-000000000005';
const reference = { ...context, reviewId };
const storageKey = 'crest.calendar-consent.pending.v1';
const csrfToken = 'A'.repeat(43);
const minimal = { clientName: false, serviceLabel: false, workAddress: false };
const longAccount = 'fictional-owner-'.repeat(10) + '@example.test';
const panels = ['panel', 'options', 'preview', 'checks', 'actions'];

async function browserFixture() {
  const globalCss = await readFile(new URL('../../src/app/globals.css', import.meta.url), 'utf8');
  const moduleCss = await readFile(new URL('../../src/app/settings/google-calendar-consent.module.css', import.meta.url), 'utf8');
  const compiled = await build({
    input: 'tests/support/google-calendar-consent-browser-entry.tsx', platform: 'browser', write: false,
    transform: { jsx: 'react-jsx', define: { 'process.env.NODE_ENV': JSON.stringify('production') } },
    output: { format: 'iife', sourcemap: false },
    plugins: [{
      name: 'calendar-test-css-module',
      resolveId(id) {
        if (id === './google-calendar-consent.module.css') return '\0crest-calendar-module-classes';
      },
      load(id) {
        if (id === '\0crest-calendar-module-classes')
          return 'export default ' + JSON.stringify(Object.fromEntries(panels.map(name => [name, name])));
      },
    }],
    onwarn(warning) { if (warning.code !== 'MODULE_LEVEL_DIRECTIVE') throw Error(warning.code); },
  });
  const script = compiled.output.find(part => part.type === 'chunk').code;
  assert(!['crest_commands.', 'node:crypto', 'oauth2.googleapis.com', 'calendar.app.created'].some(text => script.includes(text)));
  const assets = {
    '/fixture.js': ['text/javascript', script],
    '/fixture.css': ['text/css', globalCss + '\n' + moduleCss],
    '/fonts/IBMPlexSans-Regular.woff2': ['font/woff2', await readFile(new URL('../../public/fonts/IBMPlexSans-Regular.woff2', import.meta.url))],
    '/fonts/IBMPlexSans-SemiBold.woff2': ['font/woff2', await readFile(new URL('../../public/fonts/IBMPlexSans-SemiBold.woff2', import.meta.url))],
    '/': ['text/html', '<!DOCTYPE html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Crest Calendar review test</title><link rel="stylesheet" href="/fixture.css"><main><h1>Settings</h1><div id="calendar-test"></div></main><script src="/fixture.js" defer></script></html>'],
  };
  const server = createServer(await browserTestTls(), (request, response) => {
    const asset = Object.hasOwn(assets, request.url) ? assets[request.url] : null;
    response.writeHead(asset ? 200 : 404, asset ? { 'content-type': asset[0], 'cache-control': 'no-store' } : {});
    response.end(asset?.[1]);
  });
  await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
  return { origin: 'https://127.0.0.1:' + server.address().port,
    close: () => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }) };
}

for (const engine of [chromium, webkit]) {
  test(engine.name() + ' reviews optional Calendar sharing and recovers an interrupted confirmation', { timeout: 90000 }, async () => {
    const fixture = await browserFixture();
    let browser;
    try {
      browser = await engine.launch();
      const browserContext = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 390, height: 900 } });
      const page = await browserContext.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      let confirms = 0, statuses = 0, latestSelection = null, failPreview = true;
      const safeJson = { 'cache-control': 'private, no-store' };
      await page.route(fixture.origin + '/api/auth/session', route => route.fulfill({
        json: { csrfToken, expiresAt: Date.now() + 300000 }, headers: safeJson,
      }));
      await page.route(fixture.origin + '/api/business/google-calendar/consent/*', async route => {
        assert.equal(route.request().method(), 'POST');
        assert.equal(route.request().headers()['x-crest-csrf'], csrfToken);
        const body = route.request().postDataJSON();
        const command = route.request().url().split('/').at(-1);
        if (command === 'preview') {
          if (failPreview) { failPreview = false; return route.abort(); }
          latestSelection = { clientName: body.clientName, serviceLabel: body.serviceLabel, workAddress: body.workAddress };
          assert.deepEqual(body, { ...context, ...latestSelection });
          return route.fulfill({ headers: safeJson, json: {
            ...googleCalendarInitialConsentPreview(fixture.origin, latestSelection), schemaVersion: 1, disclosure: latestSelection,
            reviewId, destinationId: context.destinationId, credentialId: context.credentialId,
            expiresAt: new Date(Date.now() + 300000).toISOString(), googleOwner: longAccount,
            providerCalendarId: 'fictional@group.calendar.google.com',
          } });
        }
        if (command === 'confirm') {
          confirms++;
          assert.deepEqual(body, { ...reference, ...latestSelection, payloadReviewed: true, sharingReviewed: true, notificationsReviewed: true });
          return route.abort();
        }
        assert.equal(command, 'status');
        assert.deepEqual(body, reference);
        statuses++;
        return route.fulfill({ headers: safeJson, json: statuses === 1 ? { schemaVersion: 1, state: 'absent' }
          : { schemaVersion: 1, state: 'active', destinationId: context.destinationId, consentId, generation: '1' } });
      });
      await page.goto(fixture.origin);
      const panel = page.getByRole('region', { name: 'Google Calendar' });
      const status = panel.getByRole('status');
      const directory = new URL('../../.local/google-calendar-consent-visual/', import.meta.url);
      await mkdir(directory, { recursive: true });
      const screenshot = name => page.screenshot({ path: fileURLToPath(new URL(engine.name() + '-' + name + '.png', directory)), fullPage: true });
      const open = panel.getByText('Optional details to share', { exact: true });
      await expect(panel.getByLabel('Client display name')).toBeHidden();
      const preview = panel.getByRole('button', { name: 'Review shared event' });
      await screenshot('default-390');
      await preview.press('Enter');
      await expect(status).toContainText('could not load the preview');
      await preview.press('Enter');
      await expect(status).toHaveText('Event preview ready.');
      assert.deepEqual(latestSelection, minimal);
      await expect(panel.getByText('Crest job', { exact: true })).toBeVisible();
      await expect(panel.getByText('Example location')).toHaveCount(0);
      const approve = panel.getByRole('button', { name: 'Save Calendar consent' });
      await expect(approve).toBeDisabled();
      await panel.getByRole('button', { name: 'Change shared details' }).click();
      await open.press('Enter');
      await panel.getByLabel('Service label').press('Space');
      await panel.getByLabel('Work address').check();
      await preview.press('Enter');
      await expect(panel.getByText('Crest job · Sample Detail', { exact: true })).toBeVisible();
      await expect(panel.getByText('123 Sample Lane', { exact: true })).toBeVisible();
      await expect(panel.getByText('Sample Client')).toHaveCount(0);
      for (const width of [360, 390, 768, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        const violations = await new AxeBuilder({ page }).analyze();
        assert.deepEqual(violations.violations.map(item => item.id), []);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
        const label = panel.getByText('I checked Calendar notifications and lock-screen previews.');
        assert((await label.boundingBox()).height >= 44);
        assert((await approve.boundingBox()).height >= 44);
        await screenshot(width);
      }
      await page.setViewportSize({ width: 390, height: 900 });
      await panel.getByLabel(/I reviewed the event fields/).press('Space');
      await panel.getByLabel(/I checked who can access/).check();
      await expect(approve).toBeDisabled();
      await panel.getByLabel(/I checked Calendar notifications/).check();
      await approve.press('Enter');
      await expect(status).toContainText('could not confirm the save');
      assert.equal(confirms, 1);
      assert.deepEqual(await page.evaluate(key => JSON.parse(sessionStorage.getItem(key)), storageKey), reference);
      await page.reload();
      await expect(status).toContainText('whether the earlier consent was saved');
      await expect(panel.getByText(longAccount)).toHaveCount(0);
      await screenshot('recovery-390');
      const check = panel.getByRole('button', { name: 'Check save status' });
      await check.press('Enter');
      await expect(status).toContainText('no confirmed save yet');
      await expect(approve).toHaveCount(0);
      await check.press('Enter');
      await expect(status).toContainText('Calendar consent was saved');
      assert.equal(await page.evaluate(key => sessionStorage.getItem(key), storageKey), null);
      assert.equal(confirms, 1);
      assert.equal(statuses, 2);
      assert.deepEqual(errors, []);
    } finally {
      try { await browser?.close(); } finally { await fixture.close(); }
    }
  });
}
