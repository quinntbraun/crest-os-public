import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {waitForSessionAdmissionCapacity} from './session-admission-capacity.mjs';
import {sessionAdmissionDiagnostic} from './session-admission-diagnostic.mjs';
import {observeSessionQueries} from './session-query-evidence.mjs';

export async function reviewDirectoryPrivateReturn(page,fixture,engine){
 const records=await page.evaluate(async()=>{
  const send=async(path,body,headers)=>{
   const response=await fetch('/api/'+path,{method:'POST',headers:headers??{'content-type':'application/json'},body:JSON.stringify(body)});
   if(!response.ok)throw Error('SYNTHETIC_DIRECTORY_SETUP_'+response.status);return response.json();
  };
  const proof=await send('auth/session',{}),headers={'content-type':'application/json','x-crest-csrf':proof.csrfToken},out=[];
  for(const kind of ['customer','vehicle','lead','service']){
   const root='business/'+kind+'s/',context=await send(root+'context',{},headers),id=crypto.randomUUID(),label='Synthetic private return '+kind;
   if(context.writeState!=='ready')throw Error('SYNTHETIC_DIRECTORY_NOT_READY');
   const common={schemaVersion:1,operationId:crypto.randomUUID(),recoveryEpoch:context.recoveryEpoch};
   const body=kind==='customer'?{...common,customerId:id,expectedVersion:'0',displayName:label,phone:null,email:null,contactPreference:null,outreachOptOut:false,notes:null,customerSince:null,archived:false,archiveReason:null}
    :kind==='vehicle'?{...common,vehicleId:id,expectedVersion:'0',label,year:null,make:null,model:null,color:null,vin:null,plate:null,kind:'customer_vehicle',notes:null,archived:false,archiveReason:null}
    :kind==='lead'?{...common,leadId:id,expectedVersion:'0',label,customerId:null,sourceId:null,referralText:null,phone:null,email:null,requestedScope:null,availability:null,estimatedCents:null,followUpAt:null,notes:null}
    :{...common,serviceId:id,expectedRevision:'0',code:'synthetic-private-return',active:true,name:label,inclusions:'Synthetic verified saved scope',exclusions:'',internalGuidance:null,rangeLowCents:null,rangeHighCents:null,estimatedSeconds:null};
   if((await send(root+'save',body,headers)).state!=='committed')throw Error('SYNTHETIC_DIRECTORY_NOT_COMMITTED');
   out.push({kind,id,label});
  }
  return out;
 });
 const facts=async()=>{
  const data={};
  for(const table of ['crest.customers','crest.vehicles','crest.leads','crest.services','crest.service_versions','crest_private.operations','crest_private.audit_events'])
   data[table]=(await fixture.client.query('SELECT to_jsonb(r)::text AS value FROM '+table+' r WHERE business_id=$1 ORDER BY to_jsonb(r)::text COLLATE "C"',[fixture.business])).rows;
  return data;
 };
 const before=await facts(),context=page.context(),cookies=await context.cookies(),saves=[],responses=[];
 let stage='start',currentKind='none';const queries=observeSessionQueries();
 const responseEvidence=response=>{const path=new URL(response.url()).pathname;if(path.startsWith('/api/business/')||path==='/api/auth/session'){
  responses.push({path,status:response.status()});if(responses.length>24)responses.shift();
 }};page.on('response',responseEvidence);
 const observe=request=>{if(new URL(request.url()).pathname.startsWith('/api/business/')&&new URL(request.url()).pathname.endsWith('/save'))saves.push(request);};
 page.on('request',observe);await mkdir('.local/review',{recursive:true});
 const config={
  customer:{region:'Customer directory',field:'Customer name',filter:'Include archived customers',include:'archived',scope:'includeArchived',search:'Search customers',searchField:'Customer search'},
  vehicle:{region:'Vehicle directory',field:'Vehicle label',filter:'Include archived vehicles',include:'archived',scope:'includeArchived',search:'Search vehicles',searchField:'Vehicle search',edit:'Edit vehicle'},
  lead:{region:'Lead directory',field:'Lead label',filter:'Include lost leads',include:'lost',scope:'includeLost',search:'Search leads',searchField:'Lead search'},
  service:{region:'Service directory',field:'Service name',filter:'Include inactive services',include:'inactive',scope:'includeInactive',search:'Search',searchField:'Find a service',edit:'Edit service'},
 };
 try{
  for(const {kind,id,label}of records){
   currentKind=kind;stage='directory-access';
   await waitForSessionAdmissionCapacity(fixture,{reserve:50});await context.addCookies(cookies);
   const c=config[kind],path='/'+kind+'s',root=page.getByRole('region',{name:c.region,exact:true}),field=page.getByLabel(c.field,{exact:true});
   await page.goto(fixture.origin+path);await expect(root).toHaveAttribute('aria-busy','false');
   if(kind==='lead'){
    const due=page.getByRole('group',{name:'Filter this reminder page',exact:true}).getByRole('button',{name:/^Due \(/});
    await due.click();assert.equal(new URL(page.url()).searchParams.get('reminders'),'due');
    await page.reload();await expect(due).toHaveAttribute('aria-pressed','true');
    await page.getByRole('button',{name:'All leads',exact:true}).click();
    assert.equal(new URL(page.url()).searchParams.get('view'),'directory');
   }
   await page.getByLabel(c.searchField,{exact:true}).fill(label);
   await page.getByLabel(c.filter,{exact:true}).check();
   stage='inclusion-list';
   const listResponse=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/business/'+kind+'s/list');
   await root.getByRole('button',{name:c.search,exact:true}).click();
   const response=await listResponse;
   if(response.status()!==200){let code='BODY_UNAVAILABLE';try{const body=await response.json();if(typeof body.error==='string'&&/^[A-Z_]{1,80}$/.test(body.error))code=body.error;}catch{/* Keep the actual failed status even if the browser retired its body. */}
    console.info('DIRECTORY_LIST_FAILURE '+JSON.stringify({engine,kind,status:response.status(),code}));
   }
   assert.equal(response.status(),200);assert.equal(response.request().postDataJSON()[c.scope],true);
   stage='record-open';
   await root.getByRole('button').filter({has:page.getByText(label,{exact:true})}).click();await expect(root).toHaveAttribute('aria-busy','false');
   if(c.edit)await page.getByRole('button',{name:c.edit,exact:true}).click();
   await expect(field).toHaveValue(label);const marker='Unsent private '+kind+' changes';await field.fill(marker);
   assert.equal(new URL(page.url()).searchParams.get(kind),id);assert.equal(new URL(page.url()).searchParams.get('include'),c.include);
   stage='privacy-clear';
   await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pagehide')));
   await expect(field).toHaveCount(0);await expect(page.getByText(label,{exact:true})).toHaveCount(0);
   assert.equal(await page.evaluate(value=>Object.values(sessionStorage).some(raw=>raw.includes(value)),marker),false);
   assert.equal(page.url().includes(marker),false);
   const loaded=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/business/'+kind+'s/list');
   stage='access-recheck';
   await page.getByRole('button',{name:'Load current '+kind+'s',exact:true}).click();
   const reloaded=await loaded;assert.equal(reloaded.status(),200);assert.equal(reloaded.request().postDataJSON()[c.scope],true);
   assert.equal(reloaded.request().postDataJSON().search,'');
   const reopen=page.getByRole('button',{name:'Reopen selected '+kind,exact:true});await expect(reopen).toBeVisible();
   await expect(page.getByLabel(c.filter,{exact:true})).toBeChecked();await expect(field).toHaveCount(0);
   await expect(page.getByLabel(c.searchField,{exact:true})).toHaveValue('');
   for(const width of [390,1440]){
    await page.setViewportSize({width,height:900});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    assert.deepEqual((await new AxeBuilder({page}).analyze()).violations,[]);
    const box=await reopen.boundingBox();assert(box&&box.width>=44&&box.height>=44);
    await page.screenshot({path:'.local/review/directory-private-return-'+kind+'-'+engine+'-'+width+'-ready.png',fullPage:true});
   }
   stage='explicit-reopen';await reopen.click();await expect(root).toHaveAttribute('aria-busy','false');
   assert(await root.evaluate(element=>element.contains(document.activeElement)&&/^H[1-6]$/.test(document.activeElement.tagName)));
   if(c.edit)await page.getByRole('button',{name:c.edit,exact:true}).click();await expect(field).toHaveValue(label);
   stage='record-reload';await page.reload();await expect(root).toHaveAttribute('aria-busy','false');
   if(kind==='lead')await expect(page.getByRole('button',{name:'All leads',exact:true})).toHaveAttribute('aria-current','true');
   if(c.edit)await page.getByRole('button',{name:c.edit,exact:true}).click();await expect(field).toHaveValue(label);
   stage='actual-denial';await context.clearCookies();await page.reload();await expect(root).toHaveAttribute('aria-busy','false');
   await expect(field).toHaveCount(0);await expect(page.getByText(label,{exact:true})).toHaveCount(0);
   const signIn=page.locator('a[href^="/sign-in?returnTo='+kind+'s"]').first();await expect(signIn).toBeVisible();
   const returned=new URL(await signIn.getAttribute('href'),fixture.origin);
   assert.deepEqual(Object.fromEntries(returned.searchParams),{returnTo:kind+'s',include:c.include,[kind]:id,...(kind==='lead'?{view:'directory',reminders:'due'}:{})});
   for(const width of [390,1440]){
    await page.setViewportSize({width,height:900});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    assert.deepEqual((await new AxeBuilder({page}).analyze()).violations,[]);
    await page.screenshot({path:'.local/review/directory-private-return-'+kind+'-'+engine+'-'+width+'-denied.png',fullPage:true});
   }
   assert.deepEqual(await facts(),before,'Record return must not change saved data, operations or audit');
  }
  assert.deepEqual(saves,[],'Remembered navigation must never dispatch a save');
 }catch(error){
  const diagnostic=await sessionAdmissionDiagnostic(fixture);
  console.info('DIRECTORY_PRIVATE_RETURN_FAILURE '+JSON.stringify({engine,kind:currentKind,stage,responses,
   admissions:diagnostic.admissions,provider:diagnostic.provider,
   requests:diagnostic.requests?.slice(-12).map(row=>({route:row.route,method:row.method,status:row.status,
    elapsedMs:Number.isFinite(row.elapsedMs)?row.elapsedMs:null})),queryEvidence:queries.snapshot()}));
  throw error;
 }finally{queries.stop();page.off('request',observe);page.off('response',responseEvidence);}
}
