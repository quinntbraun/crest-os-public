import assert from 'node:assert/strict';
import {test} from 'node:test';
import {observeSessionQueries} from './session-query-evidence.mjs';

const providerLive="SELECT CASE WHEN current_user='crest_web'\n THEN crest_commands.provider_session_is_live($1::uuid,$2::uuid) ELSE false END AS live";

test('provider-live observation preserves promise, arguments and real boolean outcomes without private rows',async()=>{
 const privateValue='PRIVATE_PROVIDER_SESSION_REFERENCE',values=[privateValue],calls=[];
 let response={rows:[{live:false,privateValue}]},promise=Promise.resolve(response);
 class Transport{query(...args){calls.push({receiver:this,args});return promise;}}
 const original=Transport.prototype.query,observer=observeSessionQueries(Transport),client=new Transport();
 try{
  const returned=client.query(providerLive,values);assert.equal(returned,promise);assert.equal(await returned,response);
  assert.equal(calls.length,1);assert.equal(calls[0].receiver,client);assert.equal(calls[0].args[0],providerLive);assert.equal(calls[0].args[1],values);
  assert.deepEqual(observer.snapshot().events.map(e=>[e.kind,e.live]),[['provider_live',false]]);
  response={rows:[{live:true,privateValue}]};promise=Promise.resolve(response);assert.equal(await client.query(providerLive,values),response);
  response={rows:[{live:'PRIVATE_BAD_SHAPE',privateValue}]};promise=Promise.resolve(response);await client.query(providerLive,values);
  assert.deepEqual(observer.snapshot().events.map(e=>e.live),[false,true,null]);
  assert(!JSON.stringify(observer.snapshot()).includes('PRIVATE_'));
 }finally{observer.stop();assert.equal(Transport.prototype.query,original);}
});

test('provider-live rejection retains its original error and untrusted similar SQL is unobserved',async()=>{
 const denied=Object.assign(new Error('PRIVATE_PROVIDER_LOOKUP_ERROR'),{code:'57014'});let reject=true;
 class Transport{query(){return reject?Promise.reject(denied):Promise.resolve({rows:[{live:true}]});}}
 const observer=observeSessionQueries(Transport),client=new Transport();
 try{
  await assert.rejects(client.query(providerLive),error=>error===denied);
  assert.equal(observer.snapshot().events[0].failure.sqlState,'57014');reject=false;
  await client.query("SELECT 'PRIVATE_TEXT' AS live");
  await client.query(providerLive+'; SELECT PRIVATE_TEXT');
  assert.equal(observer.snapshot().events.length,1);assert(!JSON.stringify(observer.snapshot()).includes('PRIVATE_'));
 }finally{observer.stop();}
});

test('query observation preserves real transport identity and excludes private result/parameter fields',async()=>{
 const privateValue='PRIVATE_SYNTHETIC_CREDENTIAL_MUST_NOT_APPEAR',values=[privateValue],response={rows:[{result:false,privateValue}]},promise=Promise.resolve(response),calls=[];
 class Transport{query(...args){calls.push({receiver:this,args});return promise;}}
 const original=Transport.prototype.query,observer=observeSessionQueries(Transport),client=new Transport();
 try{const returned=client.query('SELECT crest_commands.admit_session_request($1::bytea,$2::text) AS result',values);assert.equal(returned,promise);assert.equal(await returned,response);assert.equal(calls.length,1);assert.equal(calls[0].receiver,client);assert.equal(calls[0].args[1],values);assert.equal(observer.snapshot().events[0].admitted,false);assert(!JSON.stringify(observer.snapshot()).includes(privateValue));}
 finally{observer.stop();assert.equal(Transport.prototype.query,original);}
});

test('denial and synchronous errors retain identity while diagnostics expose only bounded SQLSTATE',async()=>{
 const denied=Object.assign(new Error('PRIVATE_ERROR_MESSAGE'),{code:'42501'}),sync=Object.assign(new Error('PRIVATE_SYNC_MESSAGE'),{code:'PRIVATE_CODE'});let synchronous=false;
 class Transport{query(){if(synchronous)throw sync;return Promise.reject(denied);}}
 const observer=observeSessionQueries(Transport),client=new Transport();
 try{await assert.rejects(client.query('SELECT crest_commands.app_session_snapshot($1::bytea) AS result'),error=>error===denied);synchronous=true;assert.throws(()=>client.query('SELECT current_user=$1::name'),error=>error===sync);const report=observer.snapshot();assert.equal(report.events[0].failure.sqlState,'42501');assert.equal(report.events[1].failure.sqlState,null);assert(!JSON.stringify(report).includes('PRIVATE_'));}
 finally{observer.stop();}
});

test('observation stays bounded, preserves callback return values and refuses overlapping ownership',async()=>{
 const callbackResult={private:'PRIVATE_CALLBACK_RETURN'};class Transport{query(_text,callback){if(callback){callback(null,callbackResult);return callbackResult;}return Promise.resolve({rows:[{result:true}]});}}
 const observer=observeSessionQueries(Transport),client=new Transport();
 try{assert.throws(()=>observeSessionQueries(Transport),/ALREADY_OWNED/);for(let i=0;i<80;i++)await client.query('SELECT crest_commands.admit_session_request($1,$2) AS result');let callbacks=0;assert.equal(client.query('SELECT unobserved()',()=>{callbacks++;}),callbackResult);assert.equal(callbacks,1);assert.equal(observer.snapshot().events.length,64);assert.equal(observer.snapshot().callsObserved,80);assert(!JSON.stringify(observer.snapshot()).includes('PRIVATE_'));}
 finally{observer.stop();}
});
