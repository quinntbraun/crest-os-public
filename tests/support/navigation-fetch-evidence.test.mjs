import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createContext,runInContext} from 'node:vm';
import {installNavigationFetchEvidence} from './navigation-fetch-evidence.mjs';

function environment(fetch,storageFailure=false,storage=new Map()){
 const navigation=new EventTarget();
 const context=createContext({fetch,navigation,URL,Date,Reflect,document:{readyState:'complete',visibilityState:'visible'},location:{pathname:'/schedule',href:'https://owned.invalid/schedule?job=PRIVATE_JOB',origin:'https://owned.invalid'},sessionStorage:{getItem:key=>{if(storageFailure)throw Error('PRIVATE_STORAGE_ERROR');return storage.get(key);},setItem:(key,value)=>{if(storageFailure)throw Error('PRIVATE_STORAGE_ERROR');storage.set(key,value);}}});
 runInContext('('+installNavigationFetchEvidence.toString()+')({storageName:"probe"})',context);
 return {context,navigation,storage,fetch:context.fetch,snapshot:()=>JSON.parse(storage.get('probe'))};
}

test('invocation observation preserves receiver, argument and original promise identity without observing its settlement',async()=>{
 const response={private:'PRIVATE_RESPONSE'},promise=Promise.resolve(response),calls=[],receiver={};
 Object.defineProperty(promise,'then',{value:()=>{throw Error('Observation must not attach a promise handler');}});
 const env=environment(function(...args){calls.push({receiver:this,args});return promise;});
 const options={body:'PRIVATE_BODY',headers:{cookie:'PRIVATE_COOKIE'},signal:new AbortController().signal};
 assert.equal(env.fetch.call(receiver,'/api/auth/session?secret=PRIVATE_QUERY',options),promise);
 assert.equal(calls[0].receiver,receiver);assert.equal(calls[0].args[1],options);assert.equal(calls.length,1);
 assert(!JSON.stringify(env.snapshot()).includes('PRIVATE'));
 assert.equal(env.snapshot().calls[0].document,'/schedule');
 assert.equal(await promise,response);
});

test('native rejection and synchronous throw identity remain unchanged when storage is unavailable',async()=>{
 const failure=Error('PRIVATE_FAILURE'),promise=Promise.reject(failure);let synchronous=false;
 const env=environment(()=>{if(synchronous)throw failure;return promise;},true);
 assert.equal(env.fetch('/api/auth/session',{}),promise);await assert.rejects(promise,error=>error===failure);
 synchronous=true;assert.throws(()=>env.fetch('/api/auth/session',{}),error=>error===failure);
});

test('trace bounds, cross-document navigation and abort observations contain only fixed safe metadata',()=>{
 const env=environment(()=>Promise.resolve({})),controller=new AbortController();
 const event=new Event('navigate');Object.defineProperty(event,'destination',{value:{sameDocument:false,url:'PRIVATE_DESTINATION'}});env.navigation.dispatchEvent(event);
 for(let i=0;i<40;i++)env.fetch('/api/auth/session',{signal:controller.signal});
 const before=env.snapshot();assert.equal(before.calls.length,32);assert(before.calls.every(row=>row.departing&&Number.isSafeInteger(row.navigationAt)&&row.abortedAt===null));
 controller.abort();assert(env.snapshot().calls.every(row=>Number.isSafeInteger(row.abortedAt)));
 env.navigation.dispatchEvent(new Event('navigateerror'));env.fetch('/api/auth/session',{});
 const restored=env.snapshot().calls.at(-1);assert.equal(restored.departing,false);assert.equal(restored.navigationAt,null);
 env.fetch('https://foreign.invalid/api/auth/session?private=PRIVATE_QUERY',{});assert.equal(env.snapshot().calls.length,32);
 assert(!JSON.stringify(env.snapshot()).includes('PRIVATE'));
});

test('a replacement document preserves prior calls and an older abort updates only its retained row',()=>{
 const first=environment(()=>Promise.resolve({})),controller=new AbortController();
 first.fetch('/api/auth/session',{signal:controller.signal});
 const second=environment(()=>Promise.resolve({}),false,first.storage);second.context.location.pathname='/quotes/amendments';second.fetch('/api/auth/session',{});
 assert.equal(second.snapshot().calls.length,2);
 controller.abort();const calls=second.snapshot().calls;
 assert.equal(calls[0].document,'/schedule');assert(Number.isSafeInteger(calls[0].abortedAt));
 assert.equal(calls[1].document,'/quotes/amendments');assert.equal(calls[1].abortedAt,null);
});

test('a denied storage getter leaves the native fetch completely untouched',()=>{
 const promise=Promise.resolve({}),original=()=>promise,context=createContext({fetch:original});let reads=0;
 Object.defineProperty(context,'sessionStorage',{get(){reads++;throw Error('PRIVATE_STORAGE_GETTER');}});
 runInContext('('+installNavigationFetchEvidence.toString()+')({storageName:"probe"})',context);
 assert(reads>0);assert.equal(context.fetch,original);assert.equal(context.fetch('/api/auth/session'),promise);
});
