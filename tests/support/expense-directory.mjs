import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {sourceExportBrowserFixture} from './source-export-browser-fixture.mjs';
import {observeExpenseAccess,prepareExpenseBrowserCode} from './expense-access-diagnostic.mjs';

// Real MFA, registered database and served product. File selection deliberately
// does not upload: directory navigation must neither discard it nor save it.
export async function reviewExpenseDirectory(t,name,engine){
 const f=await sourceExportBrowserFixture({product:true,workspace:true,expenses:true,expenseReceipts:true});let browser,diagnostic;
 try{
  browser=await engine.launch();const context=await browser.newContext({ignoreHTTPSErrors:true,viewport:{width:1440,height:900}}),page=await context.newPage();
  diagnostic=observeExpenseAccess(page,f);page.setDefaultTimeout(15000);page.setDefaultNavigationTimeout(30000);
  const errors=[];page.on('pageerror',()=>errors.push('page-error'));
  await page.goto(f.origin+'/expenses');await page.getByRole('link',{name:'Sign in to view expenses',exact:true}).click();
  await prepareExpenseBrowserCode(f);const credentials=f.credentials();
  await page.getByLabel('Email',{exact:true}).fill(credentials.email);await page.getByLabel('Password',{exact:true}).fill(credentials.password);await page.getByLabel('Authenticator code',{exact:true}).fill(credentials.code);
  await page.getByRole('button',{name:'Sign in',exact:true}).click();await expect(page.getByRole('heading',{name:'Session verified',exact:true})).toBeVisible();
  await page.getByRole('link',{name:'Return to Expenses',exact:true}).click();await expect(page.getByRole('status')).toHaveText('Expenses loaded.');
  const first='Fictional polishing towels '+name,second='Fictional wash supplies '+name;
  const button=description=>page.getByRole('button',{name:'Open expense: '+description,exact:true});
  const record=description=>page.getByRole('article').filter({has:page.getByRole('heading',{name:description,exact:true})});
  for(const [description,amount,vendor]of [[first,'12.99','Fictional towel merchant'],[second,'18.50','Fictional wash merchant']]){
   await page.getByRole('button',{name:'Record expense',exact:true}).click();
   await page.getByLabel('Payment date',{exact:true}).fill('2026-11-01');await page.getByLabel('Amount paid (USD)',{exact:true}).fill(amount);
   await page.getByLabel('Category',{exact:true}).selectOption('supplies');await page.getByLabel('Description',{exact:true}).fill(description);await page.getByLabel('Payment method',{exact:true}).selectOption('card');
   const vendorField=page.getByLabel('Vendor (optional)',{exact:true});if(!await vendorField.isVisible())await page.getByText('Vendor, reference and notes (optional)',{exact:true}).click();await vendorField.fill(vendor);
   await page.getByRole('button',{name:'Save expense',exact:true}).click();await expect(page.getByRole('status')).toHaveText('Saved expense revision 1.');await expect(page.getByRole('heading',{name:description,exact:true})).toBeFocused();
  }
  await page.reload();await expect(button(first)).toBeVisible();await expect(page.getByRole('heading',{name:first,exact:true})).toHaveCount(0);
  await expect(page.getByRole('region',{name:'Expense directory introduction',exact:true})).toBeVisible();
  const directory=page.getByRole('complementary',{name:'Expense directory',exact:true});
  await expect(button(first)).toContainText('Fictional towel merchant');await expect(button(first)).toContainText('supplies');
  await expect(directory.getByText('Receipts not checked',{exact:true})).toHaveCount(2);
  await button(first).press('Enter');await expect(page.getByRole('heading',{name:first,exact:true})).toBeFocused();
  const purchase=record(first);await purchase.getByText('Receipts',{exact:true}).click();await purchase.getByRole('button',{name:'Load saved receipts',exact:true}).click();
  await expect(purchase.getByRole('status')).toHaveText('Saved receipt list refreshed.');await expect(button(first)).toContainText('No saved receipts');
  const snapshot=async()=>(await f.client.query(`SELECT jsonb_build_object(
   'expenses',(SELECT jsonb_agg(to_jsonb(e) ORDER BY e.expense_id,e.revision) FROM crest.expense_revisions e WHERE e.business_id=$1),
   'receipts',(SELECT jsonb_agg(to_jsonb(r) ORDER BY r.receipt_id,r.revision) FROM crest.expense_receipt_revisions r WHERE r.business_id=$1),
   'events',(SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id) FROM crest_private.audit_events a WHERE a.business_id=$1)) AS snapshot`,[f.business])).rows[0].snapshot;
  const before=await snapshot();let requests=0;const observed=request=>{if(new URL(request.url()).pathname.startsWith('/api/'))requests++;};page.on('request',observed);
  const selectedFile={name:'fictional-unsaved-receipt.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jG2kAAAAASUVORK5CYII=','base64')};
  const file=purchase.getByLabel('Receipt file',{exact:true});await file.setInputFiles(selectedFile);
  await expect(button(first)).toContainText('Receipt task in progress');await expect(purchase.getByRole('button',{name:'Correct or void',exact:true})).toBeDisabled();
  const search=page.getByLabel('Find an expense',{exact:true});await search.fill('wash');await expect(button(first)).toHaveCount(0);await expect(purchase).toBeVisible();
  await button(second).click();await expect(purchase).toHaveCount(0);await expect(record(second)).toBeVisible();await search.fill('');await button(first).click();
  assert.deepEqual(await file.evaluate(node=>[...node.files].map(file=>({name:file.name,size:file.size,type:file.type}))),[{name:selectedFile.name,size:selectedFile.buffer.length,type:'image/png'}]);
  await expect(purchase.locator('.receipt-file-name')).toContainText(selectedFile.name);
  await page.getByRole('button',{name:'Back to expenses',exact:true}).click();await expect(button(first)).toBeFocused();await button(first).click();
  await expect(purchase.locator('.receipt-file-name')).toContainText(selectedFile.name);await purchase.getByRole('button',{name:'Clear selected file',exact:true}).click();
  await expect(purchase.getByRole('button',{name:'Correct or void',exact:true})).toBeEnabled();await purchase.getByRole('button',{name:'Correct or void',exact:true}).click();
  await page.getByLabel('Amount paid (USD)',{exact:true}).fill('14.99');await page.getByLabel('Reason for correction or void',{exact:true}).fill('Unsubmitted fictional draft');
  page.once('dialog',dialog=>dialog.dismiss());await button(second).click();await expect(page.getByLabel('Amount paid (USD)',{exact:true})).toHaveValue('14.99');
  await expect(page.getByLabel('Reason for correction or void',{exact:true})).toHaveValue('Unsubmitted fictional draft');
  await button(first).click();await expect(page.getByText('Correct an expense',{exact:true})).toBeFocused();
  page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'Cancel correction',exact:true}).click();await expect(page.getByRole('heading',{name:first,exact:true})).toBeFocused();
  await expect(page.locator('.expense-workbench-status')).toHaveText('Correction cancelled. Saved expense details are unchanged.');
  await mkdir('.local/review',{recursive:true});
  for(const width of [360,390,768,1100,1440]){
   await page.setViewportSize({width,height:900});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   await expect(directory)[width<1100?'toBeHidden':'toBeVisible']();
   assert.deepEqual((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations,[]);
   await page.screenshot({path:'.local/review/expense-directory-selected-'+name+'-'+width+'.png',fullPage:true});
   await page.getByRole('button',{name:'Back to expenses',exact:true}).click();await expect(button(first)).toBeFocused();await expect(directory).toBeVisible();
   await expect(page.locator('.expense-workbench-status')).toHaveText('Choose a saved expense to review.');
   await page.screenshot({path:'.local/review/expense-directory-list-'+name+'-'+width+'.png',fullPage:true});await button(first).click();
  }
  await file.setInputFiles(selectedFile);await expect(purchase.locator('.receipt-file-name')).toContainText(selectedFile.name);
  await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pagehide')));await expect(page.getByRole('heading',{name:first,exact:true})).toHaveCount(0);await expect(page.locator('input[type="file"]')).toHaveCount(0);
  assert.equal(await page.evaluate(()=>sessionStorage.getItem('crest.receipt.pending-reference.v1')),null);
  assert.equal(requests,0,'selecting/filtering, draft cancellation, viewport changes and suspension send no API requests');page.off('request',observed);
  assert.deepEqual(await snapshot(),before,'navigation and unsubmitted receipt/correction drafts preserve expense, receipt and audit records');assert.deepEqual(errors,[]);
 }catch(error){t.diagnostic(JSON.stringify((await diagnostic?.report())??{diagnosticUnavailable:true}));throw error;}finally{diagnostic?.stop();await browser?.close();await f.close();}
}
