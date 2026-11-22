import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {mappingBusinessSource,verifyMappingSignIn} from './mapping-workbench.mjs';
import {sessionAdmissionDiagnostic} from './session-admission-diagnostic.mjs';

export async function reviewMappingNavigation(originalPage,fixture,engine,categories,receiptReference){
 const context=await originalPage.context().browser().newContext({ignoreHTTPSErrors:true,viewport:originalPage.viewportSize()});
 try{
 const page=await context.newPage();
 await page.goto(fixture.origin+'/sign-in');
 const credentials=fixture.credentials();
 await page.getByLabel('Email',{exact:true}).fill(credentials.email);
 await page.getByLabel('Password',{exact:true}).fill(credentials.password);
 await page.getByLabel('Authenticator code',{exact:true}).fill(credentials.code);
 await page.getByRole('button',{name:'Sign in',exact:true}).click();
 await verifyMappingSignIn(page,fixture);
 const kind=categories?'category':'mapping',purpose=categories?'category_fuel':'service_revenue',date='2026-11-18';
 const path='/settings/accounts/mappings'+(categories?'/categories':'');
 const manageLabel='Manage approvals for this '+(categories?'category':'purpose');
 const returnLabel=categories?'Expense category mappings':'Dated account mappings';
 const expectedLookup=path+'?purpose='+purpose+'&lookupOn='+date,expectedManage=path+'/manage?purpose='+purpose+'&lookupOn='+date;
 const viewport=page.viewportSize(),before=await mappingBusinessSource(fixture),requests=[],observations=[];
 await page.goto(fixture.origin+path);
 if(categories)await page.getByRole('button',{name:'Select Fuel',exact:true}).click();
 else await page.getByLabel('Purpose',{exact:true}).selectOption(purpose);
 await page.getByLabel('Effective date',{exact:true}).fill(date);
 assert.equal(new URL(page.url()).pathname+new URL(page.url()).search,expectedLookup);
 await page.getByRole('link',{name:manageLabel,exact:true}).press('Enter');
 const editor=page.getByRole('region',{name:'Mapping approvals',exact:true});
 const choice=editor.getByLabel(categories?'Expense category':'Purpose',{exact:true});
 await expect(choice).toHaveValue(purpose);
 const load=editor.getByRole('button',{name:'Load approval settings',exact:true});
 await expect(load).toBeEnabled();await load.press('Enter');
 await expect(editor.getByRole('status')).toHaveText('Approval settings loaded.');
 const approve=editor.getByRole('button',{name:'Approve mapping',exact:true});
 await expect(approve).toBeEnabled();await approve.press('Enter');
 await expect(editor.getByLabel('Effective from',{exact:true})).toHaveValue('');
 await editor.getByRole('button',{name:'Cancel',exact:true}).press('Enter');
 await page.goBack();
 await expect(page.getByLabel('Effective date',{exact:true})).toHaveValue(date);
 const observe=request=>{if(new URL(request.url()).pathname.startsWith('/api/business/'))requests.push(request.method()+' '+new URL(request.url()).pathname);};
 page.on('request',observe);
 try{
  await mkdir('.local/review',{recursive:true});
  for(const width of [360,390,430,1440]){
   await page.setViewportSize({width,height:900});
   await expect(page.getByLabel('Effective date',{exact:true})).toHaveValue(date);
   const manage=page.getByRole('link',{name:manageLabel,exact:true});
   await expect(manage).toHaveAttribute('href',expectedManage);await manage.press('Enter');
   await expect(choice).toHaveValue(purpose);
   await expect(editor.getByRole('button',{name:'Load approval settings',exact:true})).toBeEnabled();
   await expect(editor.getByRole('region',{name:'Saved approval settings',exact:true})).toHaveCount(0);
   const back=page.getByRole('link',{name:returnLabel,exact:true});
   await expect(back).toHaveAttribute('href',expectedLookup);await back.focus();
   const target=await back.evaluate(node=>{const r=node.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;return {height:r.height,focusedUnobscured:document.activeElement===node&&x>=0&&x<innerWidth&&y>=0&&y<innerHeight&&node.contains(document.elementFromPoint(x,y))};});
   assert(target.height>=44);assert.equal(target.focusedUnobscured,true);
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   assert.deepEqual((await new AxeBuilder({page}).analyze()).violations.map(v=>v.id),[]);
   const managed='.local/review/mapping-return-'+kind+'-'+engine+'-'+width+'-manage.png';
   await page.screenshot({path:managed,fullPage:true,animations:'disabled'});
   await back.press('Enter');
   assert.equal(new URL(page.url()).pathname+new URL(page.url()).search,expectedLookup);
   const selection=categories?page.locator('.category-mapping-selected h2'):page.getByLabel('Purpose',{exact:true});
   await expect(selection).toBeFocused();
   if(!categories)await expect(selection).toHaveValue(purpose);
   await expect(page.getByLabel('Effective date',{exact:true})).toHaveValue(date);
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   assert.deepEqual((await new AxeBuilder({page}).analyze()).violations.map(v=>v.id),[]);
   const returned='.local/review/mapping-return-'+kind+'-'+engine+'-'+width+'-lookup.png';
   await page.screenshot({path:returned,fullPage:true,animations:'disabled'});
   observations.push({width,...target,selectionFocused:true,lookupDatePreserved:true,managed,returned});
  }
  await page.goto(fixture.origin+path+'?purpose='+purpose+'&purpose='+purpose+'&lookupOn=2026-02-30');
  await expect(page.getByLabel('Effective date',{exact:true})).toHaveValue('');
  await expect(page.getByRole('link',{name:manageLabel,exact:true})).toHaveCount(0);
  if(!categories)await expect(page.getByLabel('Purpose',{exact:true})).toHaveValue('');
  await page.goto(fixture.origin+expectedLookup);
  await expect(page.getByLabel('Effective date',{exact:true})).toHaveValue(date);
  await expect(page.getByLabel('Effective date',{exact:true})).toBeEnabled();
  await page.evaluate(()=>window.dispatchEvent(new Event('pagehide')));
  await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true})));
  await expect(page.getByLabel('Effective date',{exact:true})).toHaveValue(date);
  await expect(page.getByRole('link',{name:manageLabel,exact:true})).toHaveAttribute('href',expectedManage);
  if(!categories)await expect(page.getByLabel('Purpose',{exact:true})).toHaveValue(purpose);
  else await expect(page.locator('.category-mapping-selected h2')).toHaveText('Fuel');
  await expect(page.getByRole('region',{name:'Approved account',exact:true})).toHaveCount(0);
  await expect(page.getByRole('region',{name:'Saved mapping history',exact:true})).toHaveCount(0);
  for(const width of [360,390,430,1440]){
   await page.setViewportSize({width,height:900});
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   assert.deepEqual((await new AxeBuilder({page}).analyze()).violations.map(v=>v.id),[]);
   await page.screenshot({path:'.local/review/mapping-private-return-'+kind+'-'+engine+'-'+width+'.png',fullPage:true});
  }
  assert.deepEqual(requests,[],'Navigating safe context does not load or write financial records');
  assert.deepEqual(await mappingBusinessSource(fixture),before,'Navigation and the explicit approval review preserve mapping and audit facts');
  page.off('request',observe);
  await page.goto(fixture.origin+expectedManage);
  await expect(load).toBeEnabled();
  if(receiptReference){
   await page.evaluate(async reference=>{
    const proof=await (await fetch('/api/auth/session',{method:'POST',headers:{'content-type':'application/json'},body:'{}'})).json();
    const response=await fetch('/api/business/finance-accounts/context',{method:'POST',headers:{'content-type':'application/json','x-crest-csrf':proof.csrfToken},body:'{}'});
    if(!response.ok)throw Error('FICTIONAL_MAPPING_CONTEXT_UNAVAILABLE');
    const context=await response.json();
    const binding=response.headers.get('x-crest-edit-binding');
    if(!binding)throw Error('FICTIONAL_MAPPING_BINDING_UNAVAILABLE');
    sessionStorage.setItem('crest.finance-mapping.pending-reference.v1',JSON.stringify({businessId:context.businessId,binding,reference}));
   },receiptReference);
   await editor.getByRole('button',{name:'Review interrupted approval',exact:true}).click();
   await expect(editor.getByRole('status')).toHaveText('The original approval was confirmed.');
   await expect(editor.getByRole('region',{name:'Saved mapping change',exact:true})).toBeVisible();
  }else{
   await load.click();await expect(editor.getByRole('status')).toHaveText('Approval settings loaded.');
  }
  await expect(editor.getByRole('region',{name:'Saved approval settings',exact:true})).toBeVisible();
  await context.clearCookies();
  await load.click();
  await expect(editor.getByRole('status')).toHaveText('Sign in again to review mapping approvals.');
  await expect(editor.getByRole('region',{name:'Saved mapping change',exact:true})).toHaveCount(0);
  await expect(editor.getByRole('region',{name:'Saved approval settings',exact:true})).toHaveCount(0);
  const signIn=editor.getByRole('link',{name:'Sign in again',exact:true});
  const signInHref='/sign-in?returnTo='+(categories?'category-approvals':'mapping-approvals')+'&purpose='+purpose+'&lookupOn='+date;
  await expect(signIn).toHaveAttribute('href',signInHref);
  await signIn.click();
  const nextCredentials=fixture.credentials();
  await page.getByLabel('Email',{exact:true}).fill(nextCredentials.email);
  await page.getByLabel('Password',{exact:true}).fill(nextCredentials.password);
  await page.getByLabel('Authenticator code',{exact:true}).fill(nextCredentials.code);
  await page.getByRole('button',{name:'Sign in',exact:true}).click();
  await verifyMappingSignIn(page,fixture);
  const resume=page.getByRole('link',{name:categories?'Return to category approvals':'Return to mapping approvals',exact:true});
  await expect(resume).toHaveAttribute('href',expectedManage);
  await resume.press('Enter');
  await expect(choice).toBeEnabled();await expect(choice).toHaveValue(purpose);
  await expect(editor.getByRole('region',{name:'Saved approval settings',exact:true})).toHaveCount(0);
  await page.getByRole('link',{name:returnLabel,exact:true}).click();
  await expect(page.getByLabel('Effective date',{exact:true})).toBeEnabled();
  await expect(page.getByLabel('Effective date',{exact:true})).toHaveValue(date);
  await expect(categories?page.locator('.category-mapping-selected h2'):page.getByLabel('Purpose',{exact:true})).toBeFocused();
  if(categories){
   await page.getByLabel('Effective date',{exact:true}).fill('2026-02-15');
   await page.getByRole('button',{name:'Check account',exact:true}).click();
   const approved=page.getByRole('region',{name:'Approved account',exact:true});
   await expect(approved.getByText('5100',{exact:true})).toBeVisible();
   await context.clearCookies();
   await page.getByRole('button',{name:'View approval history',exact:true}).click();
   await expect(page.getByRole('status')).toHaveText('Sign in to check account mappings.');
   await expect(approved).toHaveCount(0);
   await expect(page.getByRole('region',{name:'No mapping on this date',exact:true})).toHaveCount(0);
   await expect(page.getByRole('link',{name:'Sign in again',exact:true})).toHaveAttribute('href','/sign-in?returnTo=category-mappings&purpose='+purpose+'&lookupOn=2026-02-15');
  }
  assert.deepEqual(await mappingBusinessSource(fixture),before,'Session recovery and receipt lookup do not change mappings or their audit trail');
  await writeFile('.local/review/mapping-return-'+kind+'-'+engine+'.json',JSON.stringify({observations,businessRequests:requests,sourceFactsPreserved:true,lookupDateNotApprovalDate:true,invalidQueryRejected:true,privateClearingPreserved:true,privateLookupNavigationPreserved:true,signInReturnVerified:true,privateReceiptClearedOnDenial:!!receiptReference,privateLookupClearedOnDenial:categories},null,2)+'\n');
 }finally{page.off('request',observe);await page.setViewportSize(viewport);}
 }catch(error){
  try{
   const evidence=await sessionAdmissionDiagnostic(fixture);
   console.info('MAPPING_RETURN_FAILURE '+JSON.stringify({engine,categories,admissions:evidence.admissions,requests:evidence.requests?.slice(-8).map(row=>({route:row.route,method:row.method,status:row.status}))}));
  }catch{console.info('MAPPING_RETURN_DIAGNOSTIC_UNAVAILABLE');}
  throw error;
 }finally{await context.close();}
}
