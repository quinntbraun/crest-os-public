import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
export async function mappingBusinessSource(f){return (await f.client.query(`SELECT jsonb_build_object(
 'versions',(SELECT jsonb_agg(to_jsonb(v) ORDER BY v.id) FROM crest.account_mapping_versions v WHERE v.business_id=$1),
 'events',(SELECT jsonb_agg(to_jsonb(e) ORDER BY e.id) FROM crest_private.audit_events e WHERE e.business_id=$1)) AS snapshot`,[f.business])).rows[0].snapshot;}
export async function reviewApprovalEntry(page,engine,kind){
 await mkdir('.local/review',{recursive:true});const original=page.viewportSize(),entry=page.getByRole('region',{name:'Choose an approval setting',exact:true});let reads=0;
 const observed=request=>{if(new URL(request.url()).pathname.startsWith('/api/business/finance-accounts/'))reads++;};page.on('request',observed);
 try{for(const width of [360,390,768,1100,1440]){await page.setViewportSize({width,height:900});await page.evaluate(async()=>{await document.fonts.ready;scrollTo(0,0);});await expect(entry.getByRole('heading',{name:'Review an approval setting',exact:true})).toBeVisible();await entry.getByRole('combobox').focus();await expect(entry.getByRole('combobox')).toBeFocused();await expect(entry.getByRole('button',{name:'Load approval settings',exact:true})).toBeDisabled();assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.deepEqual((await new AxeBuilder({page}).analyze()).violations,[]);await page.screenshot({path:'.local/review/finance-'+kind+'-entry-'+engine+'-'+width+'.png',fullPage:true});}assert.equal(reads,0,'entry layout and focus make no financial request');}
 finally{page.off('request',observed);if(original)await page.setViewportSize(original);}
}
export async function assertMappingLayout(page,width){
 const lookup=await page.locator('.mapping-lookup-pane').boundingBox(),history=await page.getByRole('region',{name:'Saved mapping history',exact:true}).boundingBox();assert(lookup&&history);
 if(width>=1100){const form=await page.locator('.mapping-lookup-form').boundingBox();assert(form&&Math.abs(form.y-history.y)<1,'desktop lookup and history align at the top');assert(lookup.x+lookup.width<=history.x,'desktop lookup and history remain side by side');}else assert(lookup.y+lookup.height<=history.y,'phone/tablet lookup and result precede history');
}
