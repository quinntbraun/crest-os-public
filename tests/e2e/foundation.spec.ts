import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test("foundation shell is accessible at desktop and 360px width", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Crest OS", exact: true })).toBeVisible();
  await expect(page.getByText("Setup in progress", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const audit = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
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
 await page.goto('/addresses?customer=invalid');await expect(page.getByRole('status')).toContainText('Choose a customer');await expect(page.getByRole('button',{name:'Add address',exact:true})).toHaveCount(0);
});
