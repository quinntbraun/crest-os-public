import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import AxeBuilder from '@axe-core/playwright';
import { chromium, expect, webkit } from '@playwright/test';
import { recoveryCluster } from '../support/recovery-drill.mjs';
import { sourceExportBrowserFixture } from '../support/source-export-browser-fixture.mjs';

const prefix = '/api/business/google-calendar/';
const settings = '/settings/google-calendar';
const referenceKey = 'crest.calendar-consent.pending.v1';


for (const automatic of [false,true]) test('signed-in Calendar preserves consent and ' + (automatic ? 'shares selected details automatically' : 'leaves a booking pending by default'), { timeout: 240000 }, async () => {
  const optional=automatic;
  const expectedStatus=automatic ? 'The current appointment is synced to the fictional calendar.' : 'A Calendar update is waiting.';
  const cluster = await recoveryCluster();
  const previous = process.env.CREST_TEST_DATABASE_URL;
  process.env.CREST_TEST_DATABASE_URL = cluster.testDatabaseUrl;
  let fixture;
  try {
    fixture = await sourceExportBrowserFixture({ product: true, workspace: true, catalog: true, quotes: true, quoteReview: true,
      quoteCommercial: true, scheduling: true, googleCalendar: true, googleCalendarAutomatic: automatic });
    const directory = new URL('../../.local/review/', import.meta.url);
    await mkdir(directory, { recursive: true });
    for (const engine of [chromium, webkit]) {
      const browser = await engine.launch();
      try {
        const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 390, height: 900 } });
        const page = await context.newPage();
        page.setDefaultTimeout(15000);
        page.setDefaultNavigationTimeout(20000);
        const crossOrigin = [];
        page.on('request', request => {
          if (!request.url().startsWith(fixture.origin + '/')) crossOrigin.push(new URL(request.url()).origin);
        });
        await page.goto(fixture.origin + '/settings');
        await expect(page.getByRole('link', { name: 'Google Calendar setup' })).toHaveCount(0);
        const denied = await page.request.post(fixture.origin + prefix + 'setup-state', { data: {} });
        assert.equal(denied.status(), 400);
        assert.deepEqual(Object.keys(await denied.json()), ['error']);
        await page.goto(fixture.origin + '/sign-in');
        const credentials = fixture.credentials();
        await page.getByLabel('Email', { exact: true }).fill(credentials.email);
        await page.getByLabel('Password', { exact: true }).fill(credentials.password);
        await page.getByLabel('Authenticator code', { exact: true }).fill(credentials.code);
        await page.getByRole('button', { name: 'Sign in', exact: true }).press('Enter');
        await expect(page.getByRole('status')).toContainText('Signed in');
        await page.goto(fixture.origin + '/settings');
        await page.getByRole('link', { name: 'Google Calendar setup' }).press('Enter');
        await expect(page).toHaveURL(fixture.origin + settings);
        const setup = page.getByRole('region', { name: 'Fictional Calendar setup' });
        await expect(setup.getByText('This workspace uses a simulated Google account', { exact: false })).toBeVisible();
        if (engine === chromium) {
          const prepare = setup.getByRole('button', { name: 'Prepare fictional calendar' });
          const stateCount = () => fixture.client.query('SELECT count(*)::int AS n FROM crest.google_calendar_destinations WHERE business_id=$1',
            [fixture.business]).then(result => result.rows[0].n);
          await expect(prepare).toBeEnabled();
          assert.equal(await stateCount(), 0);
          await prepare.press('Enter');
          const panel = page.getByRole('region', { name: 'Google Calendar', exact: true });
          await expect(panel.getByRole('button', { name: 'Review shared event' })).toBeEnabled();
          assert.equal(await stateCount(), 1);
          await page.reload();
          if (optional) {
            await panel.getByText('Optional details to share', { exact: true }).press('Enter');
            for (const label of ['Client display name', 'Service label', 'Work address']) {
              const choice = panel.getByLabel(label, { exact: true });
              await expect(choice).not.toBeChecked();
              await choice.check();
            }
          }
          await panel.getByRole('button', { name: 'Review shared event' }).press('Enter');
          await expect(panel.getByText(optional ? 'Crest job · Sample Detail · Sample Client' : 'Crest job', { exact: true })).toBeVisible();
          await expect(panel.getByText('calendar-owner@example.test', { exact: true })).toBeVisible();
          await expect(panel.getByText('Example location')).toHaveCount(optional ? 1 : 0);
          for (const width of [360, 390, 768, 1440]) {
            await page.setViewportSize({ width, height: 900 });
            const axe = await new AxeBuilder({ page }).analyze();
            assert.deepEqual(axe.violations.map(item => item.id), []);
            assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
            await page.screenshot({ path: fileURLToPath(new URL((optional ? 'settings-calendar-disclosure-' : 'settings-calendar-default-disclosure-') + engine.name() + '-' + width + '.png', directory)), fullPage: true });
          }
          await panel.getByLabel(/I reviewed the example event fields/).check();
          await panel.getByLabel(/I read how to check who can access/).check();
          await panel.getByLabel(/I read how to check notifications/).check();
          let responseStatus;
          await page.route('**' + prefix + 'consent/confirm', async route => {
            const response = await route.fetch();
            responseStatus = response.status();
            await route.abort();
          }, { times: 1 });
          await panel.getByRole('button', { name: 'Save Calendar consent' }).press('Enter');
          await expect(panel.getByRole('status')).toContainText('could not confirm the save');
          assert.equal(responseStatus, 200);
          await page.reload();
          await panel.getByRole('button', { name: 'Check save status' }).press('Enter');
          await expect(panel.getByRole('status')).toContainText('consent was saved');
          assert.equal(await page.evaluate(key => sessionStorage.getItem(key), referenceKey), null);
          const consent = await fixture.client.query('SELECT state,client_name,service_label,work_address FROM crest.google_calendar_consents WHERE business_id=$1',
            [fixture.business]);
          assert.deepEqual(consent.rows, [{ state: 'active', client_name: optional, service_label: optional, work_address: optional }]);
          const booking = Object.fromEntries(Object.entries(structuredClone(fixture.bookingRequest)).filter(([key]) => key !== 'businessId'));
          booking.payload.workLocation.instructions = 'Private calendar entry instructions';
          const saved = await page.evaluate(async bookingRequest => {
            const session = await fetch('/api/auth/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
            const proof = await session.json();
            const response = await fetch('/api/business/scheduling/book', { method: 'POST',
              headers: { 'content-type': 'application/json', 'x-crest-csrf': proof.csrfToken }, body: JSON.stringify(bookingRequest) });
            return { status: response.status, result: await response.json() };
          }, booking);
          assert.equal(saved.status, 200, JSON.stringify(saved.result));
          assert.equal(saved.result.state, 'committed');
        } else {
          await expect(setup.getByText('Calendar consent is saved.', { exact: true })).toBeVisible();
          await expect(setup.getByRole('button', { name: 'Prepare fictional calendar' })).toHaveCount(0);
          await page.reload();
          await expect(setup.getByText('Calendar consent is saved.', { exact: true })).toBeVisible();
        }
        const job = fixture.bookingRequest.jobId;
        if (automatic) await expect.poll(async () => (await fixture.client.query(
          "SELECT count(*)::int AS count FROM crest.google_calendar_dispatch_results WHERE business_id=$1 AND outcome='published' AND source_current",
          [fixture.business])).rows[0].count).toBe(1);
        await page.goto(fixture.origin + '/schedule?job=' + job);
        const link = page.getByRole('link', { name: 'Calendar sync status', exact: true });
        await expect(link).toHaveAttribute('href', settings + '?job=' + job);
        await link.press('Enter');
        await expect(page).toHaveURL(fixture.origin + settings + '?job=' + job);
        const sync = page.getByRole('region', { name: 'Saved appointment sync' });
        await expect(sync.getByRole('status')).toHaveText(expectedStatus,{timeout:15000});
        await expect(sync.getByRole('link', { name: 'Open saved job' })).toHaveAttribute('href', '/schedule?job=' + job);
        await expect(sync.getByText(/Last confirmed version 1 of 1/)).toHaveCount(automatic ? 1 : 0);
        for (const width of [360, 390, 768, 1440]) {
          await page.setViewportSize({ width, height: 900 });
          const axe = await new AxeBuilder({ page }).analyze();
          assert.deepEqual(axe.violations.map(item => item.id), []);
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
          const screenshotPrefix = automatic ? 'settings-calendar-synced-' : 'settings-calendar-pending-';
          await page.screenshot({ path: fileURLToPath(new URL(screenshotPrefix + engine.name() + '-' + width + '.png', directory)), fullPage: true });
        }
        await page.route('**' + prefix + 'job-status', route => route.abort(), { times: 1 });
        await sync.getByRole('button', { name: 'Check Calendar status' }).press('Enter');
        await expect(sync.getByRole('status')).toContainText('could not verify');
        await sync.getByRole('button', { name: 'Check Calendar status' }).press('Enter');
        await expect(sync.getByRole('status')).toHaveText(expectedStatus,{timeout:15000});
        await page.reload();
        await expect(sync.getByRole('status')).toHaveText(expectedStatus,{timeout:15000});
        assert.deepEqual(crossOrigin, []);
      } finally {
        await browser.close();
      }
    }
    const admissions = (await fixture.client.query("SELECT count(*)::int AS count FROM crest.google_calendar_request_admissions WHERE business_id=$1 AND kind='insert'",
      [fixture.business])).rows[0].count;
    assert.equal(admissions, automatic ? 1 : 0);
    if (automatic) {
      const [{ body }] = (await fixture.client.query(
        "SELECT request_body::jsonb AS body FROM crest.google_calendar_dispatch_sends WHERE business_id=$1 AND action='insert'", [fixture.business])).rows;
      assert.equal(body.summary, optional ? 'Crest job · Fictional Calendar interior · Synthetic lifecycle customer' : 'Crest job');
      assert.equal(body.location, optional ? 'Synthetic workshop, 123 Example Lane, Indianapolis' : '');
      for (const text of ['Private calendar entry instructions', 'Private calendar fixture scope', 'Private calendar catalog guidance',
        'Synthetic lifecycle sedan', 'Synthetic interior', '25000']) assert(!JSON.stringify(body).includes(text), text);
    }
  } finally {
    try { await fixture?.close(); }
    finally {
      if (previous === undefined) delete process.env.CREST_TEST_DATABASE_URL;
      else process.env.CREST_TEST_DATABASE_URL = previous;
      await cluster.close();
    }
  }
});
