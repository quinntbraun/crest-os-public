// Actual React unmount/scope changes and downloads in both pinned browsers.
// Deferred UI-only clients are explicit; not authentication/persistence proof.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {join,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'node:http';
import {build} from 'rolldown';
import {chromium,webkit} from 'playwright';
const root=fileURLToPath(new URL('../../',import.meta.url));
test('deferred exports and receipt downloads cannot create private downloads after unmount or source replacement',async()=>{
 const directory=await mkdtemp(join(root,'.local/expense-lifecycle-'));let server;
 try{
  const bundle=join(directory,'entry.js');await build({input:join(root,'tests/fixtures/owner-expenses-lifecycle.tsx'),platform:'browser',transform:{jsx:'react-jsx'},output:{file:bundle,format:'esm'}});const js=await readFile(bundle);
  server=createServer((req,res)=>{res.setHeader('content-type',req.url==='/entry.js'?'text/javascript':'text/html');res.end(req.url==='/entry.js'?js:'<!doctype html><html lang="en"><head><title>Synthetic lifecycle regression</title></head><body><div id="root"></div><script type="module" src="/entry.js"></script></body></html>');});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  for(const engine of [chromium,webkit]){const browser=await engine.launch();try{
   for(const mode of ['export','receipt'])for(const leave of ['Leave expense screen','Change source scope',null]){
    const page=await browser.newPage(),downloads=[];page.on('download',download=>downloads.push(download));await page.goto('http://127.0.0.1:'+server.address().port+'/?mode='+mode);
    if(mode==='export'){await page.getByRole('button',{name:'Load saved expenses',exact:true}).click();await page.getByRole('status').filter({hasText:'Expenses loaded'}).waitFor();await page.getByLabel('From',{exact:true}).fill('2026-10-01');await page.getByLabel('Through',{exact:true}).fill('2026-10-31');await page.getByRole('button',{name:'Download private expense CSV and notes',exact:true}).click();}
    else{await page.getByText('Receipts',{exact:true}).click();await page.getByRole('button',{name:'Load saved receipts',exact:true}).click();await page.getByRole('button',{name:'Download receipt 1',exact:true}).click();}
    await page.getByLabel('Deferred state').filter({hasText:'Deferred request started'}).waitFor();if(leave)await page.getByRole('button',{name:leave,exact:true}).click();await page.getByRole('button',{name:'Complete deferred request',exact:true}).click();await page.getByLabel('Deferred state').filter({hasText:'Deferred request completed'}).waitFor();
    // A real request round trip runs after the promise/React continuation, rather
    // than relying on a timing sleep to assert that no download was emitted.
    await page.evaluate(async()=>{await fetch('/settled',{cache:'no-store'});});
    const counts=JSON.parse(await page.getByLabel('Private download creations').textContent());assert.deepEqual(counts,leave?{blobCount:0,urlCount:0}:mode==='export'?{blobCount:2,urlCount:2}:{blobCount:0,urlCount:1});assert.equal(downloads.length,leave?0:mode==='export'?2:1);await page.close();
   }
  }finally{await browser.close();}}
 }finally{if(server)await new Promise(resolve=>server.close(resolve));assert(resolve(directory).startsWith(resolve(root,'.local')+sep));await rm(directory,{recursive:true,force:true});}
},{timeout:120000});
