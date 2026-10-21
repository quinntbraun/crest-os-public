import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes,randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { AuthClient } from '@supabase/auth-js';
import { exportJWK,generateKeyPair,SignJWT } from 'jose';

export function authResult(result,stage) {
  if(result.error) {
    const code=typeof result.error.code==='string'&&/^[a-z_]{1,64}$/.test(result.error.code)?result.error.code:'unknown';
    const status=Number.isSafeInteger(result.error.status)?result.error.status:0;
    const kind=['AuthApiError','AuthUnknownError','AuthRetryableFetchError'].includes(result.error.name)?result.error.name:'AuthError';
    throw new Error(`SYNTHETIC_AUTH_${stage}_${code}_${status}_${kind}`); // no message, cause, response or tokens
  }
  return result.data;
}
const listen=server=>new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',()=>resolve(server.address().port));});
const close=server=>new Promise(resolve=>{server.closeAllConnections();server.close(()=>resolve());});
const docker=(args,env=process.env)=>execFileSync('docker',args,{env,stdio:['ignore','pipe','pipe'],timeout:20000,maxBuffer:128*1024}).toString().trim();

// Test-only path bridge, not Supabase's managed API gateway. It never signs,
// synthesizes or rewrites provider responses, JWTs, users or MFA results.
export async function startRealAuthService(target,{jwtExpiry=3600}={}) {
  assert(Number.isSafeInteger(jwtExpiry)&&jwtExpiry>=2&&jwtExpiry<=3600,'bounded synthetic JWT lifetime required');
  const db=new URL(target);assert.equal(process.env.CREST_ENV,'test');
  assert(['127.0.0.1','[::1]'].includes(db.hostname));assert.match(db.pathname,/^\/crest_migrate_[a-f0-9]{16}$/);assert(!db.search&&!db.hash);
  const {testAuthImage}=JSON.parse(await readFile(new URL('../../release/toolchain.json',import.meta.url),'utf8'));
  assert.match(testAuthImage,/^supabase\/gotrue:v2\.197\.0@sha256:[a-f0-9]{64}$/);
  const reservation=createServer();const port=await listen(reservation);await close(reservation);
  const upstream=`http://127.0.0.1:${port}`;
  const publicKey=`sb_publishable_${randomBytes(24).toString('base64url')}`;
  const bridge=createServer((request,response)=>{void (async()=>{
    const publicJwks=request.url==='/auth/v1/.well-known/jwks.json'&&request.method==='GET';
    if(!request.url?.startsWith('/auth/v1/')||!publicJwks&&request.headers.apikey!==publicKey) {response.writeHead(404);response.end();return;}
    const chunks=[];let size=0;
    for await(const chunk of request){size+=chunk.length;if(size>32768)throw new Error();chunks.push(chunk);}
    const headers={'content-type':'application/json'};
    if(request.headers.authorization)headers.authorization=request.headers.authorization;
    const result=await fetch(`${upstream}${request.url.slice('/auth/v1'.length)}`,{method:request.method,headers,
      body:['GET','HEAD'].includes(request.method)?undefined:Buffer.concat(chunks),redirect:'error',signal:AbortSignal.timeout(5000)});
    // Enrollment returns a large SVG QR code. Only this test bridge accepts1MiB;
    // the production boundary excludes enrollment and keeps its128KiB limit.
    const data=Buffer.from(await result.arrayBuffer());if(data.length>1024*1024)throw new Error();
    response.writeHead(result.status,{'content-type':result.headers.get('content-type')??'application/json'});response.end(data);
  })().catch(()=>{if(!response.headersSent)response.writeHead(503);response.end();});});
  const bridgePort=await listen(bridge);const issuer=`http://127.0.0.1:${bridgePort}/auth/v1`;
  let container;const clients=new Set();
  const makeSdk=(authorization)=>{
    const client=new AuthClient({url:issuer,headers:{apikey:publicKey,...authorization?{Authorization:`Bearer ${authorization}`}:{}} ,
      autoRefreshToken:false,persistSession:false,detectSessionInUrl:false,debug:false});
    clients.add(client);return client;
  };
  const waitHealthy=async()=>{
    const deadline=Date.now()+20000;let healthy=false;
    while(Date.now()<deadline&&!healthy){
      try{const response=await fetch(`${upstream}/health`,{signal:AbortSignal.timeout(1000)});const health=await response.json();
        healthy=response.ok&&health.name==='GoTrue'&&/^v?2\.197\.0$/.test(health.version);
      }catch{/* startup only; no raw cause */}
      if(!healthy)await delay(100);
    }
    if(!healthy)throw new Error('SYNTHETIC_AUTH_HEALTH_REQUIRED');
  };
  const cleanup=async()=>{
    let failed=false;
    for(const client of clients){try{await client.dispose();}catch{failed=true;}}
    if(container){try{docker(['rm','--force',container]);}catch{failed=true;}}
    await close(bridge);
    if(failed)throw new Error('SYNTHETIC_AUTH_CLEANUP_FAILED');
  };
  try {
    const {privateKey}=await generateKeyPair('ES256',{extractable:true});const kid=randomUUID();
    const key={...await exportJWK(privateKey),kid,alg:'ES256',use:'sig',key_ops:['sign','verify']};
    db.searchParams.set('options','-c role=supabase_auth_admin -c search_path=auth,public');
    const env={...process.env,GOTRUE_DB_DATABASE_URL:db.toString(),GOTRUE_DB_DRIVER:'postgres',GOTRUE_DB_NAMESPACE:'auth',
      GOTRUE_SITE_URL:'http://127.0.0.1:3000',API_EXTERNAL_URL:issuer,GOTRUE_API_HOST:'127.0.0.1',GOTRUE_API_PORT:String(port),
      GOTRUE_JWT_SECRET:randomBytes(48).toString('base64url'),GOTRUE_JWT_KEYS:JSON.stringify([key]),GOTRUE_JWT_ISSUER:issuer,
      GOTRUE_JWT_AUD:'authenticated',GOTRUE_JWT_DEFAULT_GROUP_NAME:'authenticated',GOTRUE_JWT_EXP:String(jwtExpiry),
      GOTRUE_DISABLE_SIGNUP:'true',GOTRUE_EXTERNAL_EMAIL_ENABLED:'true',GOTRUE_MAILER_AUTOCONFIRM:'false',
      GOTRUE_MFA_TOTP_ENROLL_ENABLED:'true',GOTRUE_MFA_TOTP_VERIFY_ENABLED:'true',GOTRUE_SESSIONS_SINGLE_PER_USER:'false',
      GOTRUE_MFA_RATE_LIMIT_CHALLENGE_AND_VERIFY:'1000',GOTRUE_RATE_LIMIT_TOKEN_REFRESH:'1000',GOTRUE_RATE_LIMIT_SIGN_IN_SIGN_UP:'1000',GOTRUE_LOG_LEVEL:'error'};
    // Explicit names below prevent inherited provider configuration entering the container.
    const allowed=['DB_DATABASE_URL','DB_DRIVER','DB_NAMESPACE','SITE_URL','API_HOST','API_PORT','JWT_SECRET','JWT_KEYS','JWT_ISSUER','JWT_AUD','JWT_DEFAULT_GROUP_NAME','JWT_EXP',
      'DISABLE_SIGNUP','EXTERNAL_EMAIL_ENABLED','MAILER_AUTOCONFIRM','MFA_TOTP_ENROLL_ENABLED','MFA_TOTP_VERIFY_ENABLED','SESSIONS_SINGLE_PER_USER',
      'MFA_RATE_LIMIT_CHALLENGE_AND_VERIFY','RATE_LIMIT_TOKEN_REFRESH','RATE_LIMIT_SIGN_IN_SIGN_UP','LOG_LEVEL'].map(k=>`GOTRUE_${k}`);
    const created=docker(['create','--network','host','--read-only','--tmpfs','/tmp','--cap-drop','ALL','--security-opt','no-new-privileges','--log-driver','none',
      '--label',`crest.synthetic-auth=${randomUUID()}`,...[...allowed,'API_EXTERNAL_URL'].flatMap(k=>['--env',k]),testAuthImage,'auth','serve'],env);
    assert.match(created,/^[a-f0-9]{64}$/);container=created;docker(['start',container]);
    await waitHealthy();
    const adminJwt=await new SignJWT({role:'service_role',aud:'authenticated',iss:issuer}).setProtectedHeader({alg:'ES256',kid,typ:'JWT'}).setIssuedAt().setExpirationTime('1h').sign(privateKey);
    const admin=makeSdk(adminJwt);await admin.initialize();
    return {issuer,publicKey,admin,sdk:makeSdk,close:cleanup,
      async stop(){docker(['stop','--time','5',container]);},async restart(){docker(['start',container]);await waitHealthy();}};
  } catch {
    await cleanup();
    // Container/SDK causes can contain synthetic private keys and credentials.
    throw new Error('SYNTHETIC_AUTH_SERVICE_START_FAILED');
  }
}
