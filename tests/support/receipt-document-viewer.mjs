import assert from 'node:assert/strict';
import {expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
export async function reviewReceiptDocumentViewer(page,{fixture:f,expense,engine}){
 const snapshot=async()=>(await f.client.query(`SELECT jsonb_build_object(
  'expenses',(SELECT jsonb_agg(to_jsonb(e) ORDER BY e.expense_id,e.revision) FROM crest.expense_revisions e WHERE e.business_id=$1),
  'receipts',(SELECT jsonb_agg(to_jsonb(r) ORDER BY r.receipt_id,r.revision) FROM crest.expense_receipt_revisions r WHERE r.business_id=$1),
  'events',(SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id) FROM crest_private.audit_events a WHERE a.business_id=$1)) AS snapshot`,[f.business])).rows[0].snapshot;
 const before=await snapshot(),original=page.viewportSize(),errors=[];const failed=()=>errors.push('page-error');page.on('pageerror',failed);
 const enlarge=expense.getByRole('button',{name:'Enlarge receipt preview',exact:true}),viewer=page.getByRole('dialog',{name:'Receipt preview',exact:true});
 try{
  await enlarge.press('Enter');await expect(viewer).toBeVisible();await expect(viewer.getByRole('button',{name:'Close viewer',exact:true})).toBeFocused();
  await expect(viewer).toContainText('Fictional towel purchase');await expect(viewer).toContainText('Recorded expense: $12.99 USD');await expect(viewer).toContainText('Paid on');
  const image=viewer.getByRole('img',{name:'Enlarged verified receipt preview',exact:true}),zoom=viewer.getByLabel('Preview zoom',{exact:true});await expect(image).toBeVisible();await expect.poll(()=>image.evaluate(node=>node.naturalWidth)).toBeGreaterThan(0);
  let requests=0;const observed=request=>{if(new URL(request.url()).pathname.startsWith('/api/'))requests++;};page.on('request',observed);
  try{
   for(let i=0;i<8;i++)await page.keyboard.press('Tab');assert(await viewer.evaluate(node=>node.contains(document.activeElement)),'native dialog keeps keyboard focus inside');
   for(let i=0;i<4;i++)await viewer.getByRole('button',{name:'Zoom in',exact:true}).click();await expect(zoom).toHaveText('300%');await expect(viewer.getByRole('button',{name:'Zoom in',exact:true})).toBeDisabled();
   assert(await viewer.locator('.receipt-viewer-viewport').evaluate(node=>node.scrollWidth>node.clientWidth),'enlarged image scrolls within the viewer');
   await viewer.getByRole('button',{name:'Fit to width',exact:true}).click();await expect(zoom).toHaveText('100% · Fit to width');
   await viewer.getByRole('button',{name:'Zoom out',exact:true}).click();await viewer.getByRole('button',{name:'Zoom out',exact:true}).click();await expect(zoom).toHaveText('50%');await expect(viewer.getByRole('button',{name:'Zoom out',exact:true})).toBeDisabled();await viewer.getByRole('button',{name:'Fit to width',exact:true}).click();await expect(zoom).toHaveText('100% · Fit to width');
   for(const width of [360,390,768,1100,1440]){
    await page.setViewportSize({width,height:900});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    const close=await viewer.getByRole('button',{name:'Close viewer',exact:true}).boundingBox();assert(close&&close.x>=0&&close.y>=0&&close.x+close.width<=width&&close.y+close.height<=900);
    assert.deepEqual((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations,[]);
    await page.screenshot({path:'.local/review/receipt-viewer-'+engine+'-'+width+'.png'});
   }
   await page.setViewportSize({width:844,height:390});const close=await viewer.getByRole('button',{name:'Close viewer',exact:true}).boundingBox();assert(close&&close.y>=0&&close.y+close.height<=390);await page.screenshot({path:'.local/review/receipt-viewer-landscape-'+engine+'.png'});
   await page.keyboard.press('Escape');await expect(viewer).toBeHidden();await expect(enlarge).toBeFocused();assert.equal(requests,0,'enlarge, zoom, fit and close make no API request');
  }finally{page.off('request',observed);}
  await enlarge.click();await expect(image).toBeVisible();await image.evaluate(node=>{node.src='blob:'+location.origin+'/'+crypto.randomUUID();});await expect(viewer.getByRole('status',{name:'Receipt image display status',exact:true})).toContainText('could not be displayed');await expect(viewer.getByRole('button',{name:'Zoom in',exact:true})).toBeDisabled();await viewer.getByRole('button',{name:'Close viewer',exact:true}).click();await expect(enlarge).toBeFocused();
  await enlarge.click();await expect(image).toBeVisible();const privateUrl=await image.getAttribute('src');await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pagehide')));await expect(viewer).toHaveCount(0);assert(await page.evaluate(url=>fetch(url).then(()=>false,()=>true),privateUrl),'suspension revokes the private preview URL');
  if(original)await page.setViewportSize(original);
  await page.getByRole('button',{name:'Check expense access',exact:true}).click();await expect(page.getByRole('status').filter({hasText:'Expenses loaded.'})).toBeVisible();await page.getByRole('button',{name:'Open expense: Fictional towel purchase',exact:true}).click();await expense.getByText('Receipts',{exact:true}).click();await expense.getByRole('button',{name:'Load saved receipts',exact:true}).click();await expect(expense.getByRole('status')).toHaveText('Saved receipt list refreshed.');await expense.getByRole('button',{name:'View preview for receipt 1',exact:true}).click();await expect(expense.getByRole('img',{name:'Verified receipt preview',exact:true})).toBeVisible();
  assert.deepEqual(await snapshot(),before,'viewer and private-state recovery do not change expense, receipt or audit records');assert.equal(errors.length,0,'receipt viewer emits no page errors');
 }finally{page.off('pageerror',failed);if(original)await page.setViewportSize(original);}
}
