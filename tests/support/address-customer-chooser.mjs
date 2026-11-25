import assert from 'node:assert/strict';
import {expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {join} from 'node:path';

export async function reviewAddressCustomerChooser(page,{fixture:f,engine:name,customerName}){
 const source=async()=>(await f.client.query(`SELECT jsonb_build_object(
  'customers',(SELECT jsonb_agg(to_jsonb(c) ORDER BY c.id) FROM crest.customers c WHERE c.business_id=$1),
  'addresses',(SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id) FROM crest.addresses a WHERE a.business_id=$1),
  'events',(SELECT jsonb_agg(to_jsonb(e) ORDER BY e.id) FROM crest_private.audit_events e WHERE e.business_id=$1)) AS snapshot`,[f.business])).rows[0].snapshot;
 const before=await source();let lookups=0;const observed=request=>{if(request.url().endsWith('/api/business/customers/list'))lookups++;};page.on('request',observed);
 try{
  await page.goto(f.origin+'/addresses');const chooser=page.getByRole('region',{name:'Choose an address customer',exact:true}),status=page.getByRole('status',{name:'Address customer search status',exact:true});
  await expect(chooser).toBeVisible();await expect(status).toHaveText('Search saved customers by name, phone or email.');assert.equal(lookups,0,'no customer read before explicit search');
  const query=chooser.getByRole('searchbox',{name:'Customer name, phone or email',exact:true}),find=chooser.getByRole('button',{name:'Find customers',exact:true});
  await query.fill('Synthetic no matching customer');await find.click();await expect(status).toContainText('No matching customers');
  await page.route('**/api/business/customers/list',route=>route.abort('failed'));
  try{await query.fill(customerName);await find.click();await expect(status).toContainText('could not be verified');await expect(chooser.locator('.address-chooser-results')).toHaveCount(0);}finally{await page.unroute('**/api/business/customers/list');}
  await find.click();await expect(status).toContainText('Choose a customer');const open=chooser.getByRole('link',{name:'Open addresses for '+customerName,exact:true});await expect(open).toBeVisible();await expect(chooser).toContainText('5555550123');
  for(const width of [360,390,768,1100,1440]){
   await page.setViewportSize({width,height:width<768?844:950});await page.evaluate(()=>scrollTo(0,0));assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   if(width<768){const record=await open.boundingBox(),navigation=await page.getByRole('navigation',{name:'Main navigation',exact:true}).boundingBox();assert(record&&navigation&&record.y+record.height<=navigation.y,'first matching customer fits above phone navigation');}
   assert.deepEqual((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations,[]);
   await page.screenshot({path:join('.local/review',`address-customer-chooser-${name}-${width}.png`),fullPage:true});
  }
  await page.evaluate(()=>window.dispatchEvent(new Event('pagehide')));await expect(query).toHaveValue('');await expect(chooser.locator('.address-chooser-results')).toHaveCount(0);await expect(status).toContainText('results cleared');
  await query.fill(customerName);await find.click();await expect(open).toBeVisible();const href=await open.getAttribute('href');assert.match(href,/^\/addresses\?customer=[0-9a-f-]{36}$/);
  await open.click();await expect(page.getByRole('status',{name:'Address editor status',exact:true})).toContainText('Choose an address or add a new address.');await expect(page.getByRole('region',{name:'Choose an address customer',exact:true})).toHaveCount(0);
  assert.deepEqual(await source(),before,'customer lookup/open must not change customer, address or audit source');
 }finally{page.off('request',observed);}
}
