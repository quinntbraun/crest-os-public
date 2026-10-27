import {createServer} from 'node:http';
import {randomBytes,randomUUID} from 'node:crypto';
import {readFile,mkdir,writeFile,rename} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join,resolve} from 'node:path';
import {build} from 'rolldown';
import {createReviewData} from './data.mjs';
import {createReviewAddressLookup} from './address-lookup.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
export async function buildReview(directory=join(root,'.local','owner-review')){
 await mkdir(directory,{recursive:true});
 await build({input:join(root,'review/entry.tsx'),platform:'browser',transform:{jsx:'react-jsx',define:{'process.env.NODE_ENV':JSON.stringify('production'),'process.env':'{}'}},output:{file:join(directory,'review.js'),format:'iife',sourcemap:false,minify:true},onwarn(w){if(w.code!=='MODULE_LEVEL_DIRECTIVE')throw Error('REVIEW_BUILD_FAILED:'+w.code);}});
 const js=await readFile(join(directory,'review.js'),'utf8');if(Buffer.byteLength(js)>2097152)throw Error('REVIEW_BUNDLE_TOO_LARGE');
 for(const value of ['crest_commands.','CREST_TEST_DATABASE_URL','AUTHENTICATION_RUNTIME_PRIVATE','@aws-sdk/client-s3'])if(js.includes(value))throw Error('PRIVATE_MODULE_IN_REVIEW');
 const css=(await readFile(join(root,'src/app/globals.css'),'utf8'))+'\n'+await readFile(join(root,'review/review.css'),'utf8');
 const assetFile=join(directory,'assets.json'),temporary=assetFile+'.'+randomUUID()+'.tmp';
 await writeFile(temporary,JSON.stringify({js,css}),{mode:0o600});await rename(temporary,assetFile);
 return{js,css,assetFile};
}
const headers={'cache-control':'private, no-store, max-age=0','x-content-type-options':'nosniff','referrer-policy':'no-referrer','cross-origin-resource-policy':'same-origin','content-security-policy':"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"};
const html='<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Crest OS — sample workspace</title><link rel="stylesheet" href="/review.css"></head><body><div id="review-root"></div><script src="/review.js" defer></script></body></html>';
export async function startReviewServer({port=4318,assets,initial}={}){
 if(!Number.isInteger(port)||port<0||port>65535)throw Error('REVIEW_PORT_INVALID');
 const files=assets??await buildReview(),data=createReviewData(initial),lookup=createReviewAddressLookup(),token=randomBytes(32).toString('base64url'),binding=randomBytes(32).toString('base64url');let origin,active=0,lastAssets=files;
 const server=createServer({requestTimeout:10000,headersTimeout:10000,maxHeaderSize:16384},(incoming,outgoing)=>{
  const send=(status,value,type='application/json; charset=utf-8',extra={})=>{if(outgoing.destroyed)return;outgoing.writeHead(status,{...headers,'content-type':type,...extra});outgoing.end(type.startsWith('application/json')?JSON.stringify(value):value);};
  if(++active>16){active--;send(503,{error:'REVIEW_BUSY'});return;}
  outgoing.once('close',()=>{active--;});
  void(async()=>{
   try{
    if(incoming.headers.host!==new URL(origin).host){send(403,{error:'REVIEW_LOCAL_HOST_REQUIRED'});return;}
    const url=new URL(incoming.url,origin),path=url.pathname;
    if(url.hash||url.search&&!(incoming.method==='GET'&&['/addresses','/vehicles'].includes(path))){send(404,{error:'REVIEW_ROUTE_UNAVAILABLE'});return;}
    if(incoming.method==='GET'){
     if(path==='/review.js'||path==='/review.css'){
      try{if(files.assetFile){const next=JSON.parse(await readFile(files.assetFile,'utf8'));if(typeof next.js==='string'&&Buffer.byteLength(next.js)<=2097152&&typeof next.css==='string'&&Buffer.byteLength(next.css)<=262144)lastAssets=next;}}catch{/* Keep the last working bundle if a rebuild is unavailable. */}
      const current=lastAssets;
      send(200,path==='/review.js'?current.js:current.css,path==='/review.js'?'text/javascript; charset=utf-8':'text/css; charset=utf-8');
     }
     else if(path==='/_review/summary')send(200,data.summary());
     else if(path==='/_review/sample.json')send(200,data.snapshot(),'application/json; charset=utf-8',{'content-disposition':'attachment; filename="crest-sample-review.json"'});
     else if(['/','/customers','/vehicles','/leads','/lead-sources','/quotes','/addresses','/save-review','/settings','/export-files','/sign-in'].includes(path))send(200,html,'text/html; charset=utf-8');
     else send(404,{error:'REVIEW_ROUTE_UNAVAILABLE'});return;
    }
    if(incoming.method!=='POST'){send(405,{error:'REVIEW_METHOD_UNAVAILABLE'},undefined,{allow:'GET, POST'});return;}
    if(incoming.headers.origin!==origin||!/^application\/json(?:;\s*charset=utf-8)?$/i.test(incoming.headers['content-type']??'')){send(403,{error:'REVIEW_SAME_ORIGIN_REQUIRED'});incoming.resume();return;}
    const chunks=[];let bytes=0;const timer=setTimeout(()=>incoming.destroy(),5000);timer.unref();
    try{for await(const chunk of incoming){if((bytes+=chunk.length)>131072){send(413,{error:'REVIEW_BODY_TOO_LARGE'});return;}chunks.push(chunk);}}finally{clearTimeout(timer);}
    const body=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));
    if(body===null||typeof body!=='object'||Array.isArray(body)){send(400,{error:'REVIEW_INPUT_INVALID'});return;}
    if(path==='/api/auth/session'){if(Object.keys(body).length){send(400,{error:'REVIEW_INPUT_INVALID'});return;}send(200,{csrfToken:token,expiresAt:Date.now()+600000});return;}
    if(incoming.headers['x-crest-csrf']!==token){send(403,{error:'REVIEW_PROOF_REQUIRED'});return;}
    if(path==='/_review/customer-vehicles'){if(Object.keys(body).length!==1)throw Error();send(200,data.customerVehicles(body.customerId));return;}
    if(path==='/_review/address-suggestions'){try{send(200,await lookup(body));}catch(error){send(error.message==='ADDRESS_SEARCH_LIMITED'?429:503,{error:'ADDRESS_SUGGESTIONS_UNAVAILABLE'});}return;}
    if(path==='/_review/reset'){if(Object.keys(body).length){send(400,{error:'REVIEW_INPUT_INVALID'});return;}send(200,data.reset());return;}
    const normalized=path.replace('/api/business/customers/addresses/','/api/business/addresses/');
    const match=/^\/api\/business\/([a-z-]+)\/(context|list|history|save|operation|state|state-operation|state-events|vehicle-save|vehicle-operation|vehicle-list|vehicle-history|address-save|address-operation|address-list|address-history|convert|conversion-operation|conversion|conversion-links)$/.exec(normalized);
    if(!match){send(503,{error:'REVIEW_WORKFLOW_NOT_CONNECTED'});return;}
    const result=data.dispatch(match[1],match[2],body);send(result.status,result.value,'application/json; charset=utf-8',match[2]==='context'?{'x-crest-edit-binding':binding}:{});
   }catch{send(400,{error:'REVIEW_INPUT_INVALID'});}
  })();
 });
 server.maxConnections=32;server.keepAliveTimeout=5000;
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',()=>{server.off('error',reject);origin='http://127.0.0.1:'+server.address().port;resolve();});});
 return{server,origin,close:()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();})};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  if(process.argv.includes('--build-only')){await buildReview();console.log('Review screens rebuilt. Refresh the preview; the running server and sample records stay in place.');}
  else{
  let initial;try{initial=JSON.parse(await readFile(join(root,'.local/owner-review/preserved-sample.json'),'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
  const app=await startReviewServer({initial});console.log('Crest OS sample workspace: '+app.origin);console.log('Fictional data only. Memory storage resets when this process stops. No production services connected.');
  let closing=false;const close=()=>{if(closing)return;closing=true;void app.close();};process.once('SIGINT',close);process.once('SIGTERM',close);
  }
 }catch(error){console.error(error?.code==='EADDRINUSE'?'REVIEW_PORT_IN_USE: close the previous review server before restarting.':'REVIEW_START_FAILED');process.exitCode=1;}
}
