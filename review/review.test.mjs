import assert from 'node:assert/strict';
import {before,after,test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {request as httpRequest} from 'node:http';
import {mkdtemp,writeFile,rename} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {startReviewServer,buildReview} from './server.mjs';
import {parseCustomer} from '../src/customer/customer-contract.ts';
import {createReviewData} from './data.mjs';
import {createReviewAddressLookup} from './address-lookup.mjs';
import {parseAssociationCommitted} from '../src/customer/association-command-contract.ts';
import {parseLeadStateCommitted,parseLeadStatePage} from '../src/customer/lead-state-command-contract.ts';
import {parseLead} from '../src/customer/lead-contract.ts';
import {validateLeadHistoryChange} from '../src/customer/lead-history-contract.ts';
import {parseLeadVehicleCommitted,parseLeadVehiclePage,parseLeadVehicleHistory} from '../src/customer/lead-vehicle-command-contract.ts';
import {parseLeadAddressCommitted,parseLeadAddressPage,parseLeadAddressHistory} from '../src/customer/lead-address-command-contract.ts';
import {reviewConversionChild} from './conversions.mjs';
import {newConversionVehicle,newConversionAddress} from '../src/customer/lead-conversion-contract.ts';
import {leadConversionToWire,bindLeadConversionCommitted,parseLeadConversionRead,parseLeadConversionLinkPage} from '../src/customer/lead-conversion-command-contract.ts';
let app,token,context;
const post=async(path,body,headers={})=>{
 const response=await fetch(app.origin+path,{method:'POST',headers:{origin:app.origin,'content-type':'application/json','x-crest-csrf':token,...headers},body:JSON.stringify(body)});
 return{status:response.status,value:await response.json(),headers:response.headers};
};
before(async()=>{
 const directory=await mkdtemp(fileURLToPath(new URL('../.local/review-build-test-',import.meta.url))),assets=await buildReview(directory);assert(Buffer.byteLength(assets.js)<2097152);app=await startReviewServer({port:0,assets});
 const proof=await post('/api/auth/session',{});assert.equal(proof.status,200);token=proof.value.csrfToken;
 context=(await post('/api/business/customers/context',{})).value;
},{timeout:30000});
after(async()=>{await app?.close();});
const customer=(label='Test customer (sample)')=>({schemaVersion:1,operationId:randomUUID(),customerId:randomUUID(),expectedVersion:'0',recoveryEpoch:context.recoveryEpoch,displayName:label,phone:null,email:null,contactPreference:null,outreachOptOut:false,notes:null,customerSince:null,archived:false,archiveReason:null});
test('sample HTTP save/reopen/edit preserves exact receipts and refuses stale or conflicting originals',async()=>{
 const original=customer(),first=await post('/api/business/customers/save',original);assert.equal(first.status,200);assert.equal(first.value.receipt.customerVersion,'1');
 const replay=await post('/api/business/customers/save',original);assert.deepEqual(replay.value,first.value);
 const changed=await post('/api/business/customers/save',{...original,displayName:'Conflicting draft (sample)'});assert.equal(changed.status,409);assert.equal(changed.value.reason,'operation');
 const edit={...original,operationId:randomUUID(),expectedVersion:'1',displayName:'Edited customer (sample)'};assert.equal((await post('/api/business/customers/save',edit)).value.receipt.customerVersion,'2');
 const stale=await post('/api/business/customers/save',{...edit,operationId:randomUUID()});assert.equal(stale.status,409);assert.equal(stale.value.currentVersion,'2');
 const found=await post('/api/business/customers/history',{customerId:original.customerId,afterVersion:'0',pageSize:20});assert.equal(found.value.history.length,2);assert.equal(parseCustomer(found.value.customer,context.businessId).display_name,'Edited customer (sample)');
 assert.equal(found.value.history[1].before.display_name,original.displayName);
});
test('sample API supports actual vehicle and lead receipt shapes and rejects absent linked parents',async()=>{
 const vehicle={schemaVersion:1,operationId:randomUUID(),vehicleId:randomUUID(),expectedVersion:'0',recoveryEpoch:context.recoveryEpoch,label:'Review coupe',year:2020,make:'Example',model:'Coupe',color:null,vin:'SAMPLE123',plate:null,kind:'customer_vehicle',notes:null,archived:false,archiveReason:null};
 const saved=await post('/api/business/vehicles/save',vehicle);assert.equal(saved.status,200);assert.equal(saved.value.receipt.vehicleVersion,'1');
 const list=await post('/api/business/vehicles/list',{search:'SAMPLE123',afterId:null,includeArchived:false,pageSize:25});assert.equal(list.value.vehicles.length,1);
 const lead={schemaVersion:1,operationId:randomUUID(),leadId:randomUUID(),expectedVersion:'0',recoveryEpoch:context.recoveryEpoch,label:'Review inquiry',customerId:randomUUID(),sourceId:null,referralText:null,phone:null,email:null,requestedScope:null,availability:null,estimatedCents:null,followUpAt:null,notes:null};
 assert.equal((await post('/api/business/leads/save',lead)).status,409);
 const result=await post('/api/business/leads/save',{...lead,customerId:null});assert.equal(result.status,200);assert.equal(result.value.receipt.leadVersion,'1');
 const history=await post('/api/business/leads/history',{leadId:lead.leadId,afterVersion:'0',pageSize:5});assert.equal(history.value.history[0].action,'create');
});
test('foreign origins, forged proofs, foreign hosts and oversized bodies cannot mutate sample data',async()=>{
 const before=await fetch(app.origin+'/_review/summary').then(r=>r.json()),body=customer();
 assert.equal((await post('/api/business/customers/save',body,{origin:'https://example.com'})).status,403);
 assert.equal((await post('/api/business/customers/save',body,{'x-crest-csrf':'wrong'})).status,403);
 const foreignHost=await new Promise((resolve,reject)=>{const request=httpRequest(app.origin+'/api/business/customers/save',{method:'POST',headers:{host:'example.com',origin:app.origin,'content-type':'application/json','x-crest-csrf':token}},response=>{response.resume();response.on('end',()=>resolve(response.statusCode));});request.on('error',reject);request.end(JSON.stringify(body));});assert.equal(foreignHost,403);
 const large=await post('/api/business/customers/save',{...body,notes:'x'.repeat(140000)});assert.equal(large.status,413);
 const after=await fetch(app.origin+'/_review/summary').then(r=>r.json());assert.deepEqual(after,before);
});
test('review routes deliver the real compiled UI; unsupported workflows stay explicit and sample download contains no session proof',async()=>{
 const page=await fetch(app.origin);assert.equal(page.status,200);assert((await page.text()).includes('review-root'));assert(page.headers.get('content-security-policy').includes("connect-src 'self'"));
 const linked=await fetch(app.origin+'/addresses?customer='+randomUUID());assert.equal(linked.status,200);
 const absent=await post('/api/business/lead-conversions/context',{});assert.equal(absent.status,503);
 const file=await fetch(app.origin+'/_review/sample.json');assert(file.headers.get('content-disposition').includes('attachment'));const text=await file.text();assert(!text.includes(token));assert.equal(JSON.parse(text).reviewOnly,true);
 const method=await fetch(app.origin+'/api/business/customers/save',{method:'DELETE'});assert.equal(method.status,405);
});
test('explicit sample reset removes review edits and invalidates their previous request epoch',async()=>{
 const original=customer();assert.equal((await post('/api/business/customers/save',original)).status,200);
 const reset=await post('/_review/reset',{});assert.equal(reset.status,200);assert.deepEqual(reset.value.counts,{addresses:0,customers:3,vehicles:2,leads:2,'lead-sources':2,'lead-vehicles':0,'lead-addresses':0});
 assert.equal((await post('/api/business/customers/save',original)).status,400);
});
test('customer addresses save under their exact parent and review updates preserve previous sample rows and history',async()=>{
 context=(await post('/api/business/customers/context',{})).value;
 const person=customer('Address review parent (sample)');await post('/api/business/customers/save',person);
 const draft={schemaVersion:1,operationId:randomUUID(),addressId:randomUUID(),customerId:person.customerId,expectedVersion:'0',recoveryEpoch:context.recoveryEpoch,line1:'Public example location',line2:'Unit 7',city:'Example',region:null,postalCode:null,country:null,exactLocationText:null,instructions:'Keep these instructions',latitude:'40.75',longitude:'-73.98',geocodeSource:'Photon / OpenStreetMap',geocodeAccuracy:'Map suggestion; postal delivery not verified',verifiedAt:null,archived:false,archiveReason:null};
 const result=await post('/api/business/customers/addresses/save',draft);assert.equal(result.status,200);assert.equal(result.value.receipt.customerId,person.customerId);
 const history=await post('/api/business/customers/addresses/history',{customerId:person.customerId,addressId:draft.addressId,afterVersion:'0',pageSize:20});assert.equal(history.value.address.verified_at,null);assert.equal(history.value.address.line2,'Unit 7');
 const snapshot=await fetch(app.origin+'/_review/sample.json').then(r=>r.json()),restored=createReviewData(snapshot);assert.deepEqual(restored.snapshot().records,snapshot.records);assert.deepEqual(restored.snapshot().history,snapshot.history);
 const other=customer('Another address parent (sample)');await post('/api/business/customers/save',other);assert.equal((await post('/api/business/customers/addresses/history',{customerId:other.customerId,addressId:draft.addressId,afterVersion:'0',pageSize:20})).value.state,'absent');
 context=(await post('/api/business/customers/context',{})).value;
});
test('address adapter bounds real-provider effects, coarsens optional location and never calls a map match verified',async()=>{
 let calls=0,observed;
 const lookup=createReviewAddressLookup(async(url,options)=>{calls++;observed={url,options};return Response.json({features:[{type:'Feature',geometry:{type:'Point',coordinates:[-73.98,40.75]},properties:{housenumber:'476',street:'5th Avenue',city:'New York',state:'New York',postcode:'10018',country:'United States'}}]});});
 const input={query:'476 Fifth Avenue',area:'New York',near:{lat:40.75345,lon:-73.98234}},result=await lookup(input);assert.equal(calls,1);assert.equal(observed.url.hostname,'photon.komoot.io');assert.equal(observed.url.searchParams.get('lat'),'40.75');assert.equal(observed.url.searchParams.get('lon'),'-73.98');assert.equal(result.postalVerified,false);assert.equal(result.suggestions[0].line1,'476 5th Avenue');assert.equal(observed.options.redirect,'error');
 assert.deepEqual(await lookup(input),result);assert.equal(calls,1);await assert.rejects(lookup({...input,query:'Different search'}),/ADDRESS_SEARCH_LIMITED/);assert.equal(calls,1);
 await assert.rejects(lookup({...input,query:'abc'}),/ADDRESS_SEARCH_INPUT_INVALID/);assert.equal(calls,1);
});
test('a running review serves a new complete UI bundle and keeps saved rows when an incomplete rebuild is refused',async()=>{
 const directory=await mkdtemp(fileURLToPath(new URL('../.local/review-assets-test-',import.meta.url))),assetFile=join(directory,'assets.json');
 await writeFile(assetFile,JSON.stringify({js:'// first complete build',css:'body{color:black}'}));
 const live=await startReviewServer({port:0,assets:{js:'// fallback',css:'',assetFile}});
 try{
  const send=async(path,body,proof)=>fetch(live.origin+path,{method:'POST',headers:{origin:live.origin,'content-type':'application/json',...proof?{'x-crest-csrf':proof}:{}},body:JSON.stringify(body)});
  const proof=await send('/api/auth/session',{}).then(r=>r.json()),scope=await send('/api/business/customers/context',{},proof.csrfToken).then(r=>r.json());
  const input={...customer('UI rebuild review (sample)'),recoveryEpoch:scope.recoveryEpoch};assert.equal((await send('/api/business/customers/save',input,proof.csrfToken)).status,200);
  const before=await fetch(live.origin+'/_review/summary').then(r=>r.json());assert.equal(await fetch(live.origin+'/review.js').then(r=>r.text()),'// first complete build');
  await writeFile(assetFile+'.next',JSON.stringify({js:'// next complete build',css:'body{color:green}'}));await rename(assetFile+'.next',assetFile);
  assert.equal(await fetch(live.origin+'/review.js').then(r=>r.text()),'// next complete build');
  await writeFile(assetFile,'{"js":');assert.equal(await fetch(live.origin+'/review.js').then(r=>r.text()),'// next complete build');
  assert.deepEqual(await fetch(live.origin+'/_review/summary').then(r=>r.json()),before);
  assert.equal((await fetch(live.origin+'/assets.json')).status,404);
 }finally{await live.close();}
});
async function linkFixture(){
 context=(await post('/api/business/customers/context',{})).value;
 const first=customer('First link owner (sample)'),next=customer('Next link owner (sample)'),other=customer('Keeper (sample)');for(const c of [first,next,other])assert.equal((await post('/api/business/customers/save',c)).status,200);
 const vehicleId=randomUUID();assert.equal((await post('/api/business/vehicles/save',{schemaVersion:1,operationId:randomUUID(),vehicleId,expectedVersion:'0',recoveryEpoch:context.recoveryEpoch,label:'Linked review vehicle',year:null,make:null,model:null,color:null,vin:null,plate:null,kind:'customer_vehicle',notes:null,archived:false,archiveReason:null})).status,200);
 const command={schemaVersion:1,operationId:randomUUID(),recoveryEpoch:context.recoveryEpoch,expectedVersion:'0',action:'open',associationId:randomUUID(),customerId:first.customerId,vehicleId,effectiveAt:'2026-10-27T01:00:00.000000Z',relationship:'owner',isBilling:true,evidence:null,reason:null,nextAssociationId:null};
 return{first,next,other,vehicleId,command};
}
test('vehicle links preserve one original, refuse overlapping owner/billing periods, and allow an independent keeper',async()=>{
 const f=await linkFixture(),first=await post('/api/business/vehicle-associations/save',f.command);assert.equal(first.status,200);parseAssociationCommitted(first.value,context.businessId,f.command.operationId);
 assert.deepEqual((await post('/api/business/vehicle-associations/save',f.command)).value,first.value);
 assert.equal((await post('/api/business/vehicle-associations/save',{...f.command,customerId:f.next.customerId})).value.reason,'operation');
 const attempt={...f.command,operationId:randomUUID(),associationId:randomUUID(),customerId:f.next.customerId};assert.equal((await post('/api/business/vehicle-associations/save',attempt)).value.reason,'owner_period');
 assert.equal((await post('/api/business/vehicle-associations/save',{...attempt,relationship:'keeper'})).value.reason,'billing_period');
 assert.equal((await post('/api/business/vehicle-associations/save',{...attempt,relationship:'keeper',isBilling:false})).status,200);
 const list=await post('/api/business/vehicle-associations/list',{vehicleId:f.vehicleId,afterId:null,pageSize:50});assert.equal(list.value.associations.length,2);
 const links=await post('/_review/customer-vehicles',{customerId:f.first.customerId});assert.equal(links.value.links[0].label,'Linked review vehicle');assert.equal(links.value.links[0].relationship,'owner');
});
test('an atomic transfer retains both customers and old receipts, and saved snapshots retain the complete link history',async()=>{
 const f=await linkFixture(),original=(await post('/api/business/vehicle-associations/save',f.command)).value,nextId=randomUUID();
 const transfer={...f.command,operationId:randomUUID(),expectedVersion:'1',action:'transfer',customerId:f.next.customerId,effectiveAt:'2026-10-27T02:00:00.000000Z',reason:'Fictional ownership transfer',nextAssociationId:nextId};
 const result=await post('/api/business/vehicle-associations/save',transfer);assert.equal(result.status,200);parseAssociationCommitted(result.value,context.businessId,transfer.operationId);assert.equal(result.value.receipt.openedAssociationId,nextId);
 const history=await post('/api/business/vehicle-associations/history',{associationId:f.command.associationId,afterVersion:'0',pageSize:20});assert.equal(history.value.history.length,2);assert.equal(history.value.association.customer_id,f.first.customerId);assert.equal(history.value.association.close_reason,transfer.reason);
 const saved=await post('/api/business/vehicle-associations/operation',{operationId:f.command.operationId});assert.deepEqual(saved.value,original);
 assert.equal((await post('/_review/customer-vehicles',{customerId:f.next.customerId})).value.links[0].status,'Current');assert.equal((await post('/_review/customer-vehicles',{customerId:f.first.customerId})).value.links[0].status,'Historical');
 const snapshot=await fetch(app.origin+'/_review/sample.json').then(r=>r.json()),restored=createReviewData(snapshot).snapshot();assert.deepEqual(restored.records,snapshot.records);assert.deepEqual(restored.history,snapshot.history);
});
test('a conflicting transfer changes neither side, and future links are shown as scheduled rather than current',async()=>{
 const f=await linkFixture();assert.equal((await post('/api/business/vehicle-associations/save',{...f.command,isBilling:false})).status,200);
 const future={...f.command,operationId:randomUUID(),associationId:randomUUID(),customerId:f.other.customerId,relationship:'keeper',isBilling:true,effectiveAt:'2030-01-01T00:00:00.000000Z'};assert.equal((await post('/api/business/vehicle-associations/save',future)).status,200);
 assert.equal((await post('/_review/customer-vehicles',{customerId:f.other.customerId})).value.links[0].status,'Scheduled');
 const before=await fetch(app.origin+'/_review/sample.json').then(r=>r.json());
 const transfer={...f.command,operationId:randomUUID(),expectedVersion:'1',action:'transfer',customerId:f.next.customerId,effectiveAt:'2026-10-27T03:00:00.000000Z',reason:'Conflicting billing selection',nextAssociationId:randomUUID()};assert.equal((await post('/api/business/vehicle-associations/save',transfer)).value.reason,'billing_period');
 const after=await fetch(app.origin+'/_review/sample.json').then(r=>r.json());assert.deepEqual(after.records,before.records);assert.deepEqual(after.history,before.history);assert.equal((await post('/api/business/vehicle-associations/operation',{operationId:transfer.operationId})).value.state,'absent');
});
async function statusFixture(){
 context=(await post('/api/business/leads/context',{})).value;
 const intake={schemaVersion:1,operationId:randomUUID(),leadId:randomUUID(),expectedVersion:'0',recoveryEpoch:context.recoveryEpoch,label:'Status review (sample)',customerId:null,sourceId:null,referralText:'Original referral',phone:'+1 (202) 555-0140',email:'sample@example.com',requestedScope:'Interior cleaning',availability:'Saturday',estimatedCents:'12550',followUpAt:'2026-10-29T18:30:00.123456Z',notes:'Keep the intake unchanged'};
 assert.equal((await post('/api/business/leads/save',intake)).status,200);
 return{intake,command:{schemaVersion:1,operationId:randomUUID(),leadId:intake.leadId,expectedVersion:'1',recoveryEpoch:context.recoveryEpoch,fromState:'new',toState:'contacted',reason:null}};
}
test('lead status preserves intake, original receipts and mixed intake/status history with event pagination',async()=>{
 const {intake,command}=await statusFixture(),first=await post('/api/business/leads/state',command);assert.equal(first.status,200);parseLeadStateCommitted(first.value,context.businessId,command.operationId);
 assert.deepEqual((await post('/api/business/leads/state',command)).value,first.value);
 assert.equal((await post('/api/business/leads/save',{...intake,operationId:command.operationId})).value.reason,'operation');
 assert.equal((await post('/api/business/leads/state',{...command,reason:'Changed original'})).value.reason,'operation');
 assert.equal((await post('/api/business/leads/save',{...intake,operationId:randomUUID(),expectedVersion:'2',notes:'New intake note between status events'})).status,200);
 const next={...command,operationId:randomUUID(),expectedVersion:'3',fromState:'contacted',toState:'follow_up',reason:'Call next week'};assert.equal((await post('/api/business/leads/state',next)).status,200);
 const found=(await post('/api/business/leads/history',{leadId:intake.leadId,afterVersion:'0',pageSize:20})).value;assert.deepEqual(found.history.map(e=>e.action),['create','state_change','edit','state_change']);
 for(const e of found.history)validateLeadHistoryChange(e.action,e.before===null?null:parseLead(e.before,context.businessId),parseLead(e.after,context.businessId));
 assert.equal(found.lead.follow_up_at,intake.followUpAt);assert.equal(found.lead.estimated_cents,intake.estimatedCents);assert.equal(found.lead.requested_scope,intake.requestedScope);
 const page=(await post('/api/business/leads/state-events',{leadId:intake.leadId,afterVersion:'0',pageSize:1})).value;assert.equal(parseLeadStatePage(page,context.businessId,intake.leadId,'0',1).events[0].lead_version,'2');assert.equal(page.hasMore,true);
 const rest=(await post('/api/business/leads/state-events',{leadId:intake.leadId,afterVersion:'2',pageSize:1})).value;assert.equal(parseLeadStatePage(rest,context.businessId,intake.leadId,'2',1).events[0].lead_version,'4');assert.equal(rest.hasMore,false);
 assert.deepEqual((await post('/api/business/leads/state-operation',{operationId:command.operationId})).value,first.value);
});
test('lost and reopened leads retain their original reasons and survive a validated sample restore',async()=>{
 const {intake,command}=await statusFixture(),lost={...command,toState:'lost',reason:'Customer postponed the detail'};assert.equal((await post('/api/business/leads/state',lost)).status,200);
 const list=await post('/api/business/leads/list',{search:intake.label,afterId:null,pageSize:50,includeLost:false});assert(!list.value.leads.some(row=>row.id===intake.leadId));
 assert.equal((await post('/api/business/leads/state',{...command,operationId:randomUUID(),expectedVersion:'2',fromState:'lost',toState:'follow_up',reason:'Customer asked to resume'})).status,200);
 const snapshot=await fetch(app.origin+'/_review/sample.json').then(r=>r.json()),restored=createReviewData(snapshot).snapshot();assert.deepEqual(restored.records,snapshot.records);assert.deepEqual(restored.history,snapshot.history);
 const row=snapshot.records.leads.find(row=>row.id===intake.leadId);assert.equal(row.state,'follow_up');assert.equal(row.lost_reason,null);
 assert.deepEqual(snapshot.records['lead-state-events'].filter(e=>e.lead_id===row.id).map(e=>e.reason),[lost.reason,'Customer asked to resume']);
 const missing=structuredClone(snapshot);missing.records['lead-state-events'].pop();assert.throws(()=>createReviewData(missing));
 const tampered=structuredClone(snapshot);tampered.history['lead-state-events'].at(-1).after.reason='Rewritten evidence';assert.throws(()=>createReviewData(tampered));
 const rewritten=structuredClone(snapshot);rewritten.history.leads.find(e=>e.operationId===lost.operationId).after.notes='Forged intake change';assert.throws(()=>createReviewData(rewritten));
});
test('invalid, stale and unauthorized status changes cannot partially change a lead or its evidence',async()=>{
 const {command}=await statusFixture(),before=await fetch(app.origin+'/_review/sample.json').then(r=>r.json());
 for(const toState of ['won','quote_sent'])assert.equal((await post('/api/business/leads/state',{...command,toState})).status,400);
 for(const reason of [null,' ','x'.repeat(1001)])assert.equal((await post('/api/business/leads/state',{...command,toState:'lost',reason})).status,400);
 assert.equal((await post('/api/business/leads/state',{...command,fromState:'quote_needed'})).value.reason,'state');
 assert.equal((await post('/api/business/leads/state',{...command,expectedVersion:'2'})).value.reason,'version');
 assert.equal((await post('/api/business/leads/state',{...command,leadId:randomUUID()})).value.reason,'lead');
 assert.equal((await post('/api/business/leads/state',command,{'x-crest-csrf':'forged'})).status,403);
 assert.equal((await post('/api/business/leads/state',command,{origin:'https://example.com'})).status,403);
 const after=await fetch(app.origin+'/_review/sample.json').then(r=>r.json());assert.deepEqual(after.records,before.records);assert.deepEqual(after.history,before.history);assert.equal((await post('/api/business/leads/state-operation',{operationId:command.operationId})).value.state,'absent');
});
test('sample reset clears status evidence and blocks commands from the previous recovery epoch',async()=>{
 const {command}=await statusFixture();assert.equal((await post('/api/business/leads/state',command)).status,200);
 await post('/_review/reset',{});const snapshot=await fetch(app.origin+'/_review/sample.json').then(r=>r.json());assert.deepEqual(snapshot.records['lead-state-events'],[]);assert.deepEqual(snapshot.history['lead-state-events'],[]);
 assert.equal((await post('/api/business/leads/state',command)).status,400);assert.equal((await post('/api/business/leads/state-operation',{operationId:command.operationId})).value.state,'absent');
});
async function reportFixture(){
 const {intake}=await statusFixture(),snapshot=await fetch(app.origin+'/_review/sample.json').then(r=>r.json());
 const command={schemaVersion:1,operationId:randomUUID(),leadId:intake.leadId,leadVehicleId:randomUUID(),expectedVersion:'0',recoveryEpoch:context.recoveryEpoch,vehicleId:snapshot.records.vehicles[0].id,reportedLabel:'Reported blue SUV (sample)',reportedYear:2021,reportedMake:'Reported make',reportedModel:null,reportedColor:'Blue',reportedVin:null,reportedPlate:null,reportedNotes:'',requestedServicesText:'Interior detail, including pet hair',conditionNotes:'Customer reports seat stains',archived:false,archiveReason:null};
 return{command,intake,snapshot};
}
test('lead vehicle reports keep original details separate from directory vehicles, ownership and lead intake',async()=>{
 const {command,intake,snapshot}=await reportFixture(),saved=await post('/api/business/leads/vehicle-save',command);assert.equal(saved.status,200);parseLeadVehicleCommitted(saved.value,context.businessId,command.operationId);
 assert.deepEqual((await post('/api/business/leads/vehicle-save',command)).value,saved.value);
 assert.equal((await post('/api/business/leads/vehicle-save',{...command,reportedLabel:'Changed original'})).value.reason,'operation');
 assert.equal((await post('/api/business/leads/save',{...intake,operationId:command.operationId})).value.reason,'operation');
 const edit={...command,operationId:randomUUID(),expectedVersion:'1',requestedServicesText:'Interior detail and windows',conditionNotes:'Seat stains and pet hair'};assert.equal((await post('/api/business/leads/vehicle-save',edit)).status,200);
 const page=(await post('/api/business/leads/vehicle-list',{leadId:intake.leadId,afterId:null,includeArchived:false,pageSize:20})).value;assert.equal(parseLeadVehiclePage(page,context.businessId,intake.leadId,null,false,20).leadVehicles[0].reported_vehicle.label,command.reportedLabel);assert.equal(page.leadVersion,'1');
 const found=(await post('/api/business/leads/vehicle-history',{leadId:intake.leadId,leadVehicleId:command.leadVehicleId,afterVersion:'0',pageSize:20})).value;const parsed=parseLeadVehicleHistory(found,context.businessId,intake.leadId,command.leadVehicleId,'0',20);assert.equal(parsed.history[0].after.reported_vehicle.notes,'');assert.equal(parsed.history[0].after.reported_vehicle.model,null);assert.equal(parsed.history[0].after.requested_services.text,command.requestedServicesText);assert.equal(parsed.history[1].after.condition_notes,edit.conditionNotes);
 assert.deepEqual((await post('/api/business/leads/vehicle-operation',{operationId:command.operationId})).value,saved.value);
 const after=await fetch(app.origin+'/_review/sample.json').then(r=>r.json());assert.deepEqual(after.records.vehicles,snapshot.records.vehicles);assert.deepEqual(after.history.vehicles,snapshot.history.vehicles);assert.deepEqual(after.records['vehicle-associations'],snapshot.records['vehicle-associations']);assert.deepEqual(after.records.leads,snapshot.records.leads);assert.deepEqual(after.history.leads,snapshot.history.leads);
});
test('lead vehicle report archive/reopen retains reasons and refuses stale, foreign-parent and unauthorized writes',async()=>{
 const {command}=await reportFixture();assert.equal((await post('/api/business/leads/vehicle-save',command)).status,200);
 const archived={...command,operationId:randomUUID(),expectedVersion:'1',archived:true,archiveReason:'Duplicate inquiry report (sample)'};assert.equal((await post('/api/business/leads/vehicle-save',archived)).status,200);
 const body={leadId:command.leadId,afterId:null,includeArchived:false,pageSize:20};assert.equal((await post('/api/business/leads/vehicle-list',body)).value.leadVehicles.length,0);assert.equal((await post('/api/business/leads/vehicle-list',{...body,includeArchived:true})).value.leadVehicles.length,1);
 assert.equal((await post('/api/business/leads/vehicle-save',{...command,operationId:randomUUID(),expectedVersion:'2',archived:false})).status,200);
 const history=(await post('/api/business/leads/vehicle-history',{leadId:command.leadId,leadVehicleId:command.leadVehicleId,afterVersion:'0',pageSize:20})).value;assert.deepEqual(parseLeadVehicleHistory(history,context.businessId,command.leadId,command.leadVehicleId,'0',20).history.map(e=>e.action),['create','archive','reopen']);assert.equal(history.history[1].after.archived_reason,archived.archiveReason);
 const other=(await statusFixture()).intake.leadId,before=await fetch(app.origin+'/_review/sample.json').then(r=>r.json());
 const stale=await post('/api/business/leads/vehicle-save',{...command,operationId:randomUUID(),expectedVersion:'1'});assert.equal(stale.value.reason,'version');assert.equal(stale.value.currentVersion,'3');
 assert.equal((await post('/api/business/leads/vehicle-save',{...command,operationId:randomUUID(),leadId:other,expectedVersion:'3'})).value.reason,'parent');
 assert.equal((await post('/api/business/leads/vehicle-history',{leadId:other,leadVehicleId:command.leadVehicleId,afterVersion:'0',pageSize:20})).value.state,'absent');
 assert.equal((await post('/api/business/leads/vehicle-save',{...command,operationId:randomUUID(),leadVehicleId:randomUUID(),vehicleId:randomUUID()})).value.reason,'vehicle');
 assert.equal((await post('/api/business/leads/vehicle-save',{...command,operationId:randomUUID(),leadId:randomUUID()})).value.reason,'parent');
 assert.equal((await post('/api/business/leads/vehicle-save',command,{'x-crest-csrf':'forged'})).status,403);
 assert.equal((await post('/api/business/leads/vehicle-save',command,{origin:'https://example.com'})).status,403);
 const after=await fetch(app.origin+'/_review/sample.json').then(r=>r.json());assert.deepEqual(after.records,before.records);assert.deepEqual(after.history,before.history);
});
test('reported vehicles restore with their complete histories, reject broken source images and clear on reset',async()=>{
 const {command}=await reportFixture();await post('/api/business/leads/vehicle-save',command);
 const edit={...command,operationId:randomUUID(),expectedVersion:'1',conditionNotes:'Updated original report'};assert.equal((await post('/api/business/leads/vehicle-save',edit)).status,200);
 const snapshot=await fetch(app.origin+'/_review/sample.json').then(r=>r.json()),restored=createReviewData(snapshot).snapshot();assert.deepEqual(restored.records,snapshot.records);assert.deepEqual(restored.history,snapshot.history);
 const broken=structuredClone(snapshot);broken.history['lead-vehicles'].at(-1).before.reported_vehicle.label='Rewritten earlier report';assert.throws(()=>createReviewData(broken));
 const missing=structuredClone(snapshot);missing.records.leads=missing.records.leads.filter(row=>row.id!==command.leadId);missing.history.leads=missing.history.leads.filter(e=>e.after.id!==command.leadId);assert.throws(()=>createReviewData(missing));
 await post('/_review/reset',{});const cleared=await fetch(app.origin+'/_review/sample.json').then(r=>r.json());assert.deepEqual(cleared.records['lead-vehicles'],[]);assert.deepEqual(cleared.history['lead-vehicles'],[]);assert.equal((await post('/api/business/leads/vehicle-save',command)).status,400);
});
async function locationFixture(){
 const {intake}=await statusFixture();
 return{intake,command:{schemaVersion:1,operationId:randomUUID(),leadId:intake.leadId,leadAddressId:randomUUID(),expectedVersion:'0',recoveryEpoch:context.recoveryEpoch,line1:null,line2:'Unit 7',city:null,region:null,postalCode:null,country:null,exactLocationText:'Customer will confirm the entrance',instructions:'Keep the loading area clear',latitude:null,longitude:null,geocodeSource:null,geocodeAccuracy:null,verifiedAt:null,archived:false,archiveReason:null}};
}
test('lead locations retain incomplete/raw details and original receipts without creating customer addresses',async()=>{
 const {intake,command}=await locationFixture(),before=await fetch(app.origin+'/_review/sample.json').then(r=>r.json()),first=await post('/api/business/leads/address-save',command);assert.equal(first.status,200);parseLeadAddressCommitted(first.value,context.businessId,command.operationId);
 assert.deepEqual((await post('/api/business/leads/address-save',command)).value,first.value);
 const edit={...command,operationId:randomUUID(),expectedVersion:'1',line1:'476 5th Avenue',city:'New York',region:'New York',postalCode:'10018',country:'United States',latitude:'40.75318',longitude:'-73.98225',geocodeSource:'Photon / OpenStreetMap',geocodeAccuracy:'Map suggestion; postal delivery not verified'};
 assert.equal((await post('/api/business/leads/address-save',edit)).status,200);
 assert.equal((await post('/api/business/leads/address-save',{...command,instructions:'Altered original'})).value.reason,'operation');
 assert.equal((await post('/api/business/leads/save',{...intake,operationId:command.operationId})).value.reason,'operation');
 assert.deepEqual((await post('/api/business/leads/address-operation',{operationId:command.operationId})).value,first.value);
 const page=(await post('/api/business/leads/address-list',{leadId:command.leadId,afterId:null,includeArchived:false,pageSize:20})).value;assert.equal(parseLeadAddressPage(page,context.businessId,command.leadId,null,false,20).leadAddresses[0].line2,'Unit 7');assert.equal(page.leadVersion,'1');
 const found=(await post('/api/business/leads/address-history',{leadId:command.leadId,leadAddressId:command.leadAddressId,afterVersion:'0',pageSize:1})).value;const history=parseLeadAddressHistory(found,context.businessId,command.leadId,command.leadAddressId,'0',1);assert.equal(history.history[0].after.line1,null);assert.equal(history.hasMore,true);
 const rest=(await post('/api/business/leads/address-history',{leadId:command.leadId,leadAddressId:command.leadAddressId,afterVersion:'1',pageSize:20})).value;assert.equal(parseLeadAddressHistory(rest,context.businessId,command.leadId,command.leadAddressId,'1',20).leadAddress.verified_at,null);assert.equal(rest.leadAddress.instructions,command.instructions);
 const after=await fetch(app.origin+'/_review/sample.json').then(r=>r.json());for(const resource of ['customers','addresses','leads','vehicles','lead-vehicles','vehicle-associations']){assert.deepEqual(after.records[resource],before.records[resource]);assert.deepEqual(after.history[resource],before.history[resource]);}
});
test('lead location archive/reopen and parent/version/coordinate checks preserve unchanged evidence on refusal',async()=>{
 const {command}=await locationFixture();await post('/api/business/leads/address-save',command);
 const archived={...command,operationId:randomUUID(),expectedVersion:'1',archived:true,archiveReason:'Customer no longer uses this entrance'};assert.equal((await post('/api/business/leads/address-save',archived)).status,200);
 const list={leadId:command.leadId,afterId:null,includeArchived:false,pageSize:20};assert.equal((await post('/api/business/leads/address-list',list)).value.leadAddresses.length,0);assert.equal((await post('/api/business/leads/address-list',{...list,includeArchived:true})).value.leadAddresses.length,1);
 assert.equal((await post('/api/business/leads/address-save',{...command,operationId:randomUUID(),expectedVersion:'2',instructions:''})).status,200);
 const history=(await post('/api/business/leads/address-history',{leadId:command.leadId,leadAddressId:command.leadAddressId,afterVersion:'0',pageSize:20})).value;assert.deepEqual(parseLeadAddressHistory(history,context.businessId,command.leadId,command.leadAddressId,'0',20).history.map(e=>e.action),['create','archive','reopen']);assert.equal(history.history[1].after.archived_reason,archived.archiveReason);assert.equal(history.leadAddress.instructions,'');
 const other=(await statusFixture()).intake.leadId,before=await fetch(app.origin+'/_review/sample.json').then(r=>r.json());
 assert.equal((await post('/api/business/leads/address-save',{...command,operationId:randomUUID(),expectedVersion:'1'})).value.reason,'version');
 assert.equal((await post('/api/business/leads/address-save',{...command,operationId:randomUUID(),expectedVersion:'3',leadId:other})).value.reason,'parent');
 assert.equal((await post('/api/business/leads/address-history',{leadId:other,leadAddressId:command.leadAddressId,afterVersion:'0',pageSize:20})).value.state,'absent');
 assert.equal((await post('/api/business/leads/address-save',{...command,operationId:randomUUID(),leadId:randomUUID()})).value.reason,'parent');
 for(const invalid of [{latitude:'91',longitude:'0'},{latitude:'40',longitude:null},{archived:true,archiveReason:' '}])assert.equal((await post('/api/business/leads/address-save',{...command,...invalid,operationId:randomUUID()})).status,400);
 assert.equal((await post('/api/business/leads/address-save',command,{'x-crest-csrf':'forged'})).status,403);assert.equal((await post('/api/business/leads/address-save',command,{origin:'https://example.com'})).status,403);
 const after=await fetch(app.origin+'/_review/sample.json').then(r=>r.json());assert.deepEqual(after.records,before.records);assert.deepEqual(after.history,before.history);
});
test('lead location snapshots require matching parents and history, and reset invalidates old saves',async()=>{
 const {command}=await locationFixture();await post('/api/business/leads/address-save',command);assert.equal((await post('/api/business/leads/address-save',{...command,operationId:randomUUID(),expectedVersion:'1',city:'New York'})).status,200);
 const snapshot=await fetch(app.origin+'/_review/sample.json').then(r=>r.json()),restored=createReviewData(snapshot).snapshot();assert.deepEqual(restored.records,snapshot.records);assert.deepEqual(restored.history,snapshot.history);
 const broken=structuredClone(snapshot);broken.history['lead-addresses'].at(-1).before.line2='Rewritten unit';assert.throws(()=>createReviewData(broken));
 const detached=structuredClone(snapshot);detached.records.leads=detached.records.leads.filter(r=>r.id!==command.leadId);detached.history.leads=detached.history.leads.filter(e=>e.after.id!==command.leadId);assert.throws(()=>createReviewData(detached));
 await post('/_review/reset',{});const reset=await fetch(app.origin+'/_review/sample.json').then(r=>r.json());assert.deepEqual(reset.records['lead-addresses'],[]);assert.deepEqual(reset.history['lead-addresses'],[]);assert.equal((await post('/api/business/leads/address-save',command)).status,400);
});
async function conversionFixture(lost=false){
 const f=await reportFixture();await post('/api/business/leads/vehicle-save',f.command);const a={...(await locationFixture()).command,leadId:f.intake.leadId};await post('/api/business/leads/address-save',a);
 if(lost)await post('/api/business/leads/state',{schemaVersion:1,operationId:randomUUID(),recoveryEpoch:context.recoveryEpoch,leadId:f.intake.leadId,expectedVersion:'1',fromState:'new',toState:'lost',reason:'Original lost reason'});
 const snapshot=await fetch(app.origin+'/_review/sample.json').then(r=>r.json()),businessId=context.businessId,leadId=f.intake.leadId,vehicle=snapshot.records['lead-vehicles'].find(row=>row.id===f.command.leadVehicleId),address=snapshot.records['lead-addresses'].find(row=>row.id===a.leadAddressId);
 const request={schemaVersion:1,businessId,operationId:randomUUID(),recoveryEpoch:context.recoveryEpoch,conversionId:randomUUID(),leadId,expectedLeadVersion:lost?'2':'1',customer:{kind:'new',id:randomUUID(),draft:{displayName:'Converted person (sample)',phone:null,email:null,contactPreference:null,outreachOptOut:true,notes:null,customerSince:null,archived:false,archiveReason:null}},vehicles:[newConversionVehicle(vehicle,businessId,leadId,randomUUID(),randomUUID(),'customer_vehicle')],addresses:[newConversionAddress(address,businessId,leadId,randomUUID(),randomUUID())]};
 return{request,snapshot,intake:f.intake};
}
test('review conversion child identities match the independent production golden vectors',()=>{
 const vectors={customer:'9a4707b1-a8f7-8bbe-9de1-85fca8a7dfac',vehicle:'8ce78a8f-200d-8a49-8c5c-77ea91cdaa1a',address:'58be4bb7-5ccc-8612-974f-c8da37952da8',lead:'face5a0f-2ebb-8398-8098-f697898669e4'};
 for(const [role,expected]of Object.entries(vectors))assert.equal(reviewConversionChild('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333',role,'44444444-4444-4444-8444-444444444444'),expected);
});
test('conversion atomically creates selected records, preserves Lost/source/ownership evidence and replays its original receipt',async()=>{
 const {request,snapshot,intake}=await conversionFixture(true),wire=leadConversionToWire(request),saved=await post('/api/business/leads/convert',wire);assert.equal(saved.status,200);bindLeadConversionCommitted(saved.value,request);
 const after=await fetch(app.origin+'/_review/sample.json').then(r=>r.json()),lead=after.records.leads.find(row=>row.id===request.leadId);assert.equal(lead.state,'lost');assert.equal(lead.lost_reason,'Original lost reason');assert.equal(lead.customer_id,request.customer.id);assert.equal(lead.version,'3');
 for(const resource of ['lead-vehicles','lead-addresses','vehicle-associations']){assert.deepEqual(after.records[resource],snapshot.records[resource]);assert.deepEqual(after.history[resource],snapshot.history[resource]);}
 assert.equal(after.records.customers.length,snapshot.records.customers.length+1);assert.equal(after.records.vehicles.length,snapshot.records.vehicles.length+1);assert.equal(after.records.addresses.length,snapshot.records.addresses.length+1);assert.equal(after.records.addresses.find(row=>row.id===request.addresses[0].target.id).customer_id,request.customer.id);
 assert.deepEqual((await post('/api/business/leads/convert',wire)).value,saved.value);
 const customerBody={schemaVersion:1,operationId:randomUUID(),recoveryEpoch:request.recoveryEpoch,customerId:request.customer.id,expectedVersion:'1',...request.customer.draft,notes:'Later customer note'};assert.equal((await post('/api/business/customers/save',customerBody)).status,200);
 assert.equal((await post('/api/business/leads/save',{...intake,operationId:randomUUID(),expectedVersion:'3',customerId:request.customer.id,notes:'Later lead note'})).status,200);
 assert.equal((await post('/api/business/leads/save',{...intake,operationId:randomUUID(),expectedVersion:'4',customerId:null})).value.reason,'converted');
 assert.deepEqual((await post('/api/business/leads/conversion-operation',{operationId:request.operationId})).value,saved.value);
 const retained=(await post('/api/business/leads/conversion',{leadId:request.leadId})).value;assert.equal(parseLeadConversionRead(retained,request.businessId,request.leadId).conversion.customer_version,'1');
 const page=(await post('/api/business/leads/conversion-links',{leadId:request.leadId,conversionId:request.conversionId,afterId:null,pageSize:1})).value;assert.equal(parseLeadConversionLinkPage(page,request.businessId,request.leadId,request.conversionId,null,1).hasMore,true);
 const rest=(await post('/api/business/leads/conversion-links',{leadId:request.leadId,conversionId:request.conversionId,afterId:page.links[0].id,pageSize:1})).value;assert.equal(rest.links.length,1);assert.equal(rest.hasMore,false);
 const latest=await fetch(app.origin+'/_review/sample.json').then(r=>r.json()),restored=createReviewData(latest).snapshot();assert.deepEqual(restored.records,latest.records);assert.deepEqual(restored.history,latest.history);
});
test('conversion to existing destinations keeps them unchanged and permits no second conversion',async()=>{
 const {request}=await conversionFixture(),customerRow=(await fetch(app.origin+'/_review/sample.json').then(r=>r.json())).records.customers[0],vehicleRow=(await fetch(app.origin+'/_review/sample.json').then(r=>r.json())).records.vehicles[0],addressId=randomUUID();
 await post('/api/business/customers/addresses/save',{schemaVersion:1,operationId:randomUUID(),recoveryEpoch:request.recoveryEpoch,customerId:customerRow.id,addressId,expectedVersion:'0',...request.addresses[0].target.draft});
 request.customer={kind:'existing',id:customerRow.id,expectedVersion:customerRow.version};request.vehicles[0]={...request.vehicles[0],target:{kind:'existing',id:vehicleRow.id,expectedVersion:vehicleRow.version}};request.addresses[0]={...request.addresses[0],target:{kind:'existing',id:addressId,expectedVersion:'1'}};
 const before=await fetch(app.origin+'/_review/sample.json').then(r=>r.json());assert.equal((await post('/api/business/leads/convert',leadConversionToWire(request))).status,200);
 const after=await fetch(app.origin+'/_review/sample.json').then(r=>r.json());for(const resource of ['customers','vehicles','addresses']){assert.deepEqual(after.records[resource],before.records[resource]);assert.deepEqual(after.history[resource],before.history[resource]);}
 assert.equal((await post('/api/business/leads/convert',leadConversionToWire({...request,operationId:randomUUID(),conversionId:randomUUID(),expectedLeadVersion:'2'}))).value.reason,'conversion');
});
test('a stale source, destination collision, altered original or unauthorized conversion cannot partially create records',async()=>{
 const {request}=await conversionFixture(),before=await fetch(app.origin+'/_review/sample.json').then(r=>r.json());
 const bad=structuredClone(request);bad.addresses[0].expectedLeadAddressVersion='2';assert.equal((await post('/api/business/leads/convert',leadConversionToWire(bad))).value.reason,'source');
 const collision=structuredClone(request);collision.customer.id=before.records.customers[0].id;assert.equal((await post('/api/business/leads/convert',leadConversionToWire(collision))).value.reason,'destination');
 assert.equal((await post('/api/business/leads/convert',leadConversionToWire({...request,expectedLeadVersion:'2'}))).value.reason,'lead');
 assert.equal((await post('/api/business/leads/convert',leadConversionToWire(request),{'x-crest-csrf':'forged'})).status,403);assert.equal((await post('/api/business/leads/convert',leadConversionToWire(request),{origin:'https://example.com'})).status,403);
 const after=await fetch(app.origin+'/_review/sample.json').then(r=>r.json());assert.deepEqual(after.records,before.records);assert.deepEqual(after.history,before.history);assert.equal((await post('/api/business/leads/conversion-operation',{operationId:request.operationId})).value.state,'absent');
 assert.equal((await post('/api/business/leads/convert',leadConversionToWire(request))).status,200);
 assert.equal((await post('/api/business/leads/convert',leadConversionToWire({...request,customer:{...request.customer,draft:{...request.customer.draft,notes:'Changed original'}}}))).value.reason,'operation');
});
test('conversion snapshot rejects missing mappings or detached audit references, and reset clears conversion evidence',async()=>{
 const {request}=await conversionFixture();await post('/api/business/leads/convert',leadConversionToWire(request));const snapshot=await fetch(app.origin+'/_review/sample.json').then(r=>r.json());
 const broken=structuredClone(snapshot);broken.records['lead-conversion-links'].pop();assert.throws(()=>createReviewData(broken));
 const forged=structuredClone(snapshot),link=forged.records['lead-conversion-links'].find(row=>row.conversion_id===request.conversionId);link.source_audit_id=randomUUID();forged.history['lead-conversion-links'].find(a=>a.after.id===link.id).after.source_audit_id=link.source_audit_id;assert.throws(()=>createReviewData(forged));
 await post('/_review/reset',{});const cleared=await fetch(app.origin+'/_review/sample.json').then(r=>r.json());assert.deepEqual(cleared.records['lead-conversions'],[]);assert.deepEqual(cleared.records['lead-conversion-links'],[]);assert.equal((await post('/api/business/leads/convert',leadConversionToWire(request))).status,400);
});
test('the quote worksheet is available for unsaved calculation while quote save/approval remain unavailable',async()=>{
 const page=await fetch(app.origin+'/quotes');assert.equal(page.status,200);assert((await page.text()).includes('review-root'));
 for(const route of ['save','approve','send','accept'])assert.equal((await post('/api/business/quotes/'+route,{})).status,503);
 const snapshot=await fetch(app.origin+'/_review/sample.json').then(r=>r.json());assert.equal(Object.hasOwn(snapshot.records,'quotes'),false);
});
test('service review does not silently add a database catalog or pretend to save permanent services',async()=>{
 const before=await fetch(app.origin+'/_review/sample.json').then(r=>r.json());
 for(const route of ['save','archive','reopen'])assert.equal((await post('/api/business/services/'+route,{})).status,503);
 const after=await fetch(app.origin+'/_review/sample.json').then(r=>r.json());assert.deepEqual(after.records,before.records);assert.deepEqual(after.history,before.history);
 assert.equal(Object.hasOwn(after.records,'services'),false);assert.equal(Object.hasOwn(after.records,'service_versions'),false);
});
