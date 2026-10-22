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

test('default Node image reserves authentication before Next with private deny-all JSON',async({request})=>{
  for(const path of ['bootstrap','login','session','logout']){
    const response=await request.post('/api/auth/'+path,{data:{},headers:{origin:'http://127.0.0.1:3000',cookie:'synthetic=must-not-reflect'}});
    expect(response.status()).toBe(503);expect(await response.json()).toEqual({error:'AUTHENTICATION_REQUEST_FAILED'});
    const headers=response.headers();expect(headers['content-security-policy']).toContain("default-src 'none'");expect(headers['content-security-policy']).not.toContain('nonce-');
    expect(headers['cache-control']).toContain('no-store');expect(headers['set-cookie']).toBeUndefined();expect(headers['access-control-allow-origin']).toBeUndefined();expect(headers['cookie']).toBeUndefined();
  }
});
