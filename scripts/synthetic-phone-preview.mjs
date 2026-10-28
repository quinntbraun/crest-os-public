// Reuses the existing synthetic workspace; creates no account, database or bridge.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {parseSyntheticPhoneBinding,readSyntheticPhoneTls,restrictSyntheticPhoneSockets} from './synthetic-phone-binding.mjs';

const root=fileURLToPath(new URL('../',import.meta.url)),directory=join(root,'.local/synthetic-workspace');let app;
try{
 assert.equal(process.platform,'win32');assert.equal(process.argv.length,2);
 const state=JSON.parse(await readFile(join(directory,'state.json'),'utf8'));
 assert(state.schemaVersion===1&&/^[a-f0-9]{16}$/.test(state.id)&&state.databaseName===`crest_migrate_${state.id}`&&state.login===`crest_local_${state.id}`&&state.issuer==='http://127.0.0.1:54328/auth/v1'&&state.origin==='https://127.0.0.1:4319');
 const status=JSON.parse(execFileSync('C:/Program Files/NetBird/netbird.exe',['status','--json'],{stdio:['ignore','pipe','pipe'],timeout:10000,maxBuffer:262144}).toString());
 const binding=parseSyntheticPhoneBinding(JSON.parse(await readFile(join(directory,'phone-preview.json'),'utf8')),status,state.id),tls=await readSyntheticPhoneTls(directory,binding);
 const provider=await fetch(state.issuer+'/.well-known/jwks.json',{redirect:'error',signal:AbortSignal.timeout(5000)});assert(provider.ok,'START_LOOPBACK_WORKSPACE_FIRST');await provider.body?.cancel();
 process.env.NODE_ENV='production';
 const {createCrestApplication,createAuthenticationRuntime}=await import('../.local/server/application.mjs');
 const runtime=await createAuthenticationRuntime({database:{connectionString:`postgresql://${state.login}:${state.loginPassword}@127.0.0.1:54329/${state.databaseName}`,environment:'test'},provider:{issuer:state.issuer,publicKey:state.publicKey,environment:'test'},owner:state.owner,loginKey:Buffer.from(state.loginKey,'base64url'),ingress:{kind:'direct'},activeKeyId:'synthetic',keys:[{id:'synthetic',key:Buffer.from(state.tokenKey,'base64url')}]});
 app=await createCrestApplication({origin:binding.origin,environment:'test',tls,authentication:runtime.forServer(),business:{businessId:state.businessId},customers:true,vehicles:true,associations:true,leads:true,leadConversions:true,operationResolution:true,syntheticCatalog:true});
 restrictSyntheticPhoneSockets(app.server,binding);
 await new Promise((resolve,reject)=>{app.server.once('error',reject);app.server.listen(4319,binding.laptopAddress,resolve);});
 console.log('Private synthetic Crest preview: '+binding.origin+' . Only the two configured device addresses are accepted. Genuine sign-in required. Review any local certificate warning yourself. Keep workspace:start running.');
 const close=async()=>{await app.close();process.exit(0);};process.once('SIGINT',close);process.once('SIGTERM',close);
}catch{
 if(app)await app.close().catch(()=>undefined);
 console.error('SYNTHETIC_PHONE_PREVIEW_REVIEW_REQUIRED: existing loopback workspace and saved data were not reset.');process.exitCode=1;
}
