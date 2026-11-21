import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test('interrupted-save review remains private, accessible and closed by default',async({page,request})=>{
 const response=await page.goto('/save-review');expect(response?.headers()['cache-control']).toContain('no-store');await expect(page.getByRole('heading',{name:'Interrupted save review',exact:true})).toBeVisible();
 await expect(page.getByRole('status')).toContainText('The outcome could not be verified');await page.getByText('Review a different save',{exact:true}).click();await expect(page.getByLabel('Interrupted save type')).toBeVisible();await expect(page.getByLabel('Reason for retiring this original save',{exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'Confirm retirement of this original save',exact:true})).toHaveCount(0);
 for(const route of ['retire','resolution']){const denied=await request.post('/api/business/original-operations/'+route,{data:{},headers:{origin:'http://127.0.0.1:3000'}});expect(denied.status()).toBe(503);expect(await denied.json()).toEqual({error:'ORIGINAL_OPERATION_REQUEST_FAILED'});expect(denied.headers()['cache-control']).toContain('no-store');}
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations).toEqual([]);
});

test("workspace honestly reports unconfigured access at desktop and 360px width", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Today", exact: true })).toBeVisible();
  await expect(page.getByRole('link',{name:'Crest OS home',exact:true})).toHaveText('Crest OS');
  await expect(page.getByRole('link',{name:'Crest OS home',exact:true})).toHaveAttribute('href','/');
  await expect(page.getByRole('banner').getByText('Test workspace · Use fictional records only',{exact:true})).toBeVisible();
  await expect(page.getByRole('status')).toContainText('Workspace access could not be verified');
  await expect(page.getByText('No current business information is shown until access is confirmed.')).toBeVisible();
  await expect(page.getByRole('link',{name:'Open customers',exact:true})).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  // Include landmark best practices: WCAG-only tags missed the shared notice
  // outside every landmark, blocking the genuine conversion/export journeys.
  const audit = await new AxeBuilder({ page }).analyze();
  expect(audit.violations).toEqual([]);
});

test("liveness exposes no environment details and is not cached", async ({ request }) => {
  const response = await request.get("/api/health");
  expect(response.status()).toBe(200);
  expect(await response.json()).toEqual({ service: "crest-os", status: "ok" });
  expect(response.headers()["cache-control"]).toContain("no-store");
  expect(response.headers()["x-powered-by"]).toBeUndefined();
  expect(response.headers()["x-content-type-options"]).toBe("nosniff");
  expect(response.headers()["x-frame-options"]).toBe("DENY");
});

test('sign-in is accessible and honestly unavailable in the unconfigured image',async({page})=>{
  await page.goto('/sign-in');
  await expect(page.getByRole('status')).toContainText('Sign-in is not available while setup is in progress');
  await expect(page.getByRole('button',{name:'Check session',exact:true})).toBeVisible();
  await expect(page.getByLabel('Password',{exact:true})).toHaveCount(0);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations).toEqual([]);
});

test('default Node image reserves authentication before Next with private deny-all JSON',async({request})=>{
  for(const path of ['bootstrap','login','session','logout']){
    const response=await request.post('/api/auth/'+path,{data:{},headers:{origin:'http://127.0.0.1:3000',cookie:'synthetic=must-not-reflect'}});
    expect(response.status()).toBe(503);expect(await response.json()).toEqual({error:'AUTHENTICATION_REQUEST_FAILED'});
    const headers=response.headers();expect(headers['content-security-policy']).toContain("default-src 'none'");expect(headers['content-security-policy']).not.toContain('nonce-');
    expect(headers['cache-control']).toContain('no-store');expect(headers['set-cookie']).toBeUndefined();expect(headers['access-control-allow-origin']).toBeUndefined();expect(headers['cookie']).toBeUndefined();
  }
});
test('settings stays private, accessible and unavailable in the unconfigured image',async({page})=>{
  const response=await page.goto('/settings');expect(response?.headers()['cache-control']).toContain('no-store');await expect(page.getByRole('heading',{name:'Business settings',exact:true})).toBeVisible();
  await expect(page.getByRole('status')).toContainText('Business settings could not be verified');await expect(page.getByLabel('Business legal name',{exact:true})).toHaveCount(0);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations).toEqual([]);
});

test('customer editor is private and accessible while the default customer runtime remains closed',async({page,request})=>{
  const response=await page.goto('/customers');expect(response?.headers()['cache-control']).toContain('no-store');await expect(page.getByRole('heading',{name:'Customers',exact:true})).toBeVisible();
  await expect(page.getByRole('status')).toContainText('Customer access could not be verified');await expect(page.getByRole('form',{name:'Customer editor',exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'Add customer',exact:true})).toHaveCount(0);
  const denied=await request.post('/api/business/customers/list',{data:{},headers:{origin:'http://127.0.0.1:3000'}});expect(denied.status()).toBe(503);expect(denied.headers()['cache-control']).toContain('no-store');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations).toEqual([]);
});

test('address screen is private, accessible and closed without configured authentication',async({page,request})=>{
 const response=await page.goto('/addresses?customer=22222222-2222-4222-8222-222222222222');expect(response?.headers()['cache-control']).toContain('no-store');await expect(page.getByRole('heading',{name:'Customer addresses',exact:true})).toBeVisible();
 await expect(page.getByRole('status')).toContainText('Address access could not be verified');await expect(page.getByRole('form',{name:'Address editor',exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'Add address',exact:true})).toHaveCount(0);
 const denied=await request.post('/api/business/customers/addresses/list',{data:{customerId:'22222222-2222-4222-8222-222222222222'},headers:{origin:'http://127.0.0.1:3000'}});expect(denied.status()).toBe(503);expect(await denied.json()).toEqual({error:'ADDRESS_REQUEST_FAILED'});expect(denied.headers()['cache-control']).toContain('no-store');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations).toEqual([]);
 await page.goto('/addresses?customer=invalid');await expect(page.getByRole('status',{name:'Address editor status',exact:true})).toContainText('Choose a customer');await expect(page.getByRole('status',{name:'Address customer search status',exact:true})).toContainText('Search saved customers');await expect(page.getByRole('button',{name:'Add address',exact:true})).toHaveCount(0);
});

test('vehicle screen is private, accessible and closed without its explicit runtime',async({page,request})=>{
 const response=await page.goto('/vehicles');expect(response?.headers()['cache-control']).toContain('no-store');await expect(page.getByRole('heading',{name:'Vehicles',exact:true})).toBeVisible();
 await expect(page.getByRole('status')).toContainText('Vehicle access could not be verified');await expect(page.getByRole('form',{name:'Vehicle editor',exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'Add vehicle',exact:true})).toHaveCount(0);
 const denied=await request.post('/api/business/vehicles/list',{data:{},headers:{origin:'http://127.0.0.1:3000'}});expect(denied.status()).toBe(503);expect(await denied.json()).toEqual({error:'VEHICLE_REQUEST_FAILED'});expect(denied.headers()['cache-control']).toContain('no-store');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations).toEqual([]);
});

test('workspace tool search supports keyboard navigation and matching on phone and desktop',async({page})=>{
  await page.goto('/');
  await expect(page.getByRole('status')).toContainText('Workspace access could not be verified');
  const search=page.getByRole('button',{name:'Find a tool',exact:true});
  const originalViewport=page.viewportSize();
  for(const width of [320,360,390]){
    await page.setViewportSize({width,height:900});
    const target=await search.boundingBox();
    expect(target?.width).toBeGreaterThanOrEqual(44);
    expect(target?.height).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  }
  if(originalViewport)await page.setViewportSize(originalViewport);
  const dialog=page.getByRole('dialog',{name:'Find a tool',exact:true});
  await search.focus();
  await page.keyboard.press('Control+k');
  await expect(dialog).toBeVisible();
  const input=dialog.getByRole('searchbox',{name:'Search workspace tools',exact:true});
  await expect(input).toBeFocused();
  await input.fill('unmatched tool');
  await expect(dialog.getByText('No tools match that search.',{exact:true})).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(search).toBeFocused();
  await search.click();
  await expect(input).toHaveValue('');
  await input.fill('supplier bills');
  const result=dialog.getByRole('link',{name:/^Expenses/});
  await expect(result).toBeVisible();
  await expect(dialog.getByRole('link')).toHaveCount(1);
  expect((await new AxeBuilder({page}).include('.workspace-search').analyze()).violations).toEqual([]);
  await input.press('ArrowDown');
  await expect(result).toBeFocused();
  await result.press('Enter');
  await expect(page.getByRole('heading',{name:'Expenses',exact:true})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
