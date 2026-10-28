// Explicit, loopback-only development workspace. Never a production installer.
// Uses a separate persistent Docker cluster; never adopts CI or owner databases.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {createServer} from 'node:http';
import {mkdir,readFile,writeFile,access} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import pg from 'pg';
import {AuthClient} from '@supabase/auth-js';
import {exportJWK,generateKeyPair,SignJWT} from 'jose';
import {URI} from 'otpauth';
import {applySyntheticMigrations} from './synthetic-migrations.mjs';
import {importSyntheticSigningKey} from './synthetic-workspace-key.mjs';

const root=fileURLToPath(new URL('../',import.meta.url)),directory=join(root,'.local/synthetic-workspace'),statePath=join(directory,'state.json');
const origin='https://127.0.0.1:4319',issuer='http://127.0.0.1:54328/auth/v1';
const pins=JSON.parse(await readFile(join(root,'release/toolchain.json'),'utf8'));
const mode=process.argv[2];
assert(['init','start','stop'].includes(mode),'use init, start or stop');
function docker(args,env={}){try{return execFileSync('docker',args,{env:{...process.env,...env},stdio:['ignore','pipe','pipe'],timeout:120000,maxBuffer:2*1024*1024}).toString().trim();}catch{throw Error('SYNTHETIC_DOCKER_COMMAND_FAILED');}}
async function exists(path){try{await access(path);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}}
async function save(path,value){await writeFile(path,JSON.stringify(value)+'\n',{flag:'wx',mode:0o600});}
function validate(s){assert(s.schemaVersion===1&&/^[a-f0-9]{16}$/.test(s.id)&&s.databaseName===`crest_migrate_${s.id}`&&s.databaseContainer===`crest-synthetic-db-${s.id}`&&s.authContainer===`crest-synthetic-auth-${s.id}`&&s.volume===`crest-synthetic-data-${s.id}`&&s.issuer===issuer&&s.origin===origin,'SYNTHETIC_WORKSPACE_IDENTITY_REQUIRED');return s;}
function ownContainer(s,name){assert([s.databaseContainer,s.authContainer].includes(name));assert.equal(docker(['inspect','--format','{{index .Config.Labels "crest.synthetic-workspace"}}',name]),s.id,'SYNTHETIC_CONTAINER_OWNERSHIP_REQUIRED');}
function connection(s,web=false){return `postgresql://${web?s.login:'supabase_admin'}:${web?s.loginPassword:s.databasePassword}@127.0.0.1:54329/${s.databaseName}`;}
async function database(s){const client=new pg.Client({connectionString:connection(s),connectionTimeoutMillis:5000});await client.connect();return client;}
async function healthy(s){const deadline=Date.now()+90000;while(Date.now()<deadline){try{if(docker(['exec',s.databaseContainer,'pg_isready','-h','127.0.0.1','-U','supabase_admin','-d','crest_test']).includes('accepting connections'))return;}catch{/* bounded startup; ignore the initialization-only Unix socket */}await delay(500);}throw Error('SYNTHETIC_DATABASE_START_FAILED');}
async function bridge(){
 const server=createServer((request,response)=>{void(async()=>{
  const jwks=request.url==='/auth/v1/.well-known/jwks.json'&&request.method==='GET';
  if(!request.url?.startsWith('/auth/v1/')||!['GET','POST','PUT','DELETE'].includes(request.method)||!jwks&&request.headers.apikey!==state.publicKey){response.writeHead(404);response.end();return;}
  const chunks=[];let size=0;for await(const chunk of request){if((size+=chunk.length)>32768)throw Error();chunks.push(chunk);}
  const headers={'content-type':'application/json'};if(request.headers.authorization)headers.authorization=request.headers.authorization;
  const upstream=await fetch('http://127.0.0.1:54327'+request.url.slice('/auth/v1'.length),{method:request.method,headers,body:['GET','HEAD'].includes(request.method)?undefined:Buffer.concat(chunks),redirect:'error',signal:AbortSignal.timeout(5000)});
  const bytes=Buffer.from(await upstream.arrayBuffer());if(bytes.length>1024*1024)throw Error();response.writeHead(upstream.status,{'content-type':upstream.headers.get('content-type')??'application/json','cache-control':'no-store'});response.end(bytes);
 })().catch(()=>{if(!response.headersSent)response.writeHead(503);response.end();});});
 await new Promise((ok,no)=>{server.once('error',no);server.listen(54328,'127.0.0.1',ok);});return server;
}
function client(authorization){return new AuthClient({url:issuer,headers:{apikey:state.publicKey,...authorization?{Authorization:`Bearer ${authorization}`}:{}} ,autoRefreshToken:false,persistSession:false,detectSessionInUrl:false,debug:false});}
function result(value){if(value.error)throw Error('SYNTHETIC_AUTH_SETUP_FAILED');return value.data;}
async function authHealthy(){const deadline=Date.now()+30000;while(Date.now()<deadline){try{const response=await fetch('http://127.0.0.1:54327/health',{signal:AbortSignal.timeout(1000)}),body=await response.json();if(response.ok&&body.name==='GoTrue'&&/^v?2\.197\.0$/.test(body.version))return;}catch{/* startup only */}await delay(250);}throw Error('SYNTHETIC_AUTH_START_FAILED');}
let state,server,app,stage='preflight';
try{
 if(mode==='init'){
  assert.equal(process.argv.length,3,'init accepts no target or production overrides');
  await mkdir(directory,{recursive:true,mode:0o700});
  assert(!await exists(statePath),'SYNTHETIC_SETUP_EXISTS_REVIEW_REQUIRED');
  assert(!await exists(join(directory,'initializing.json')),'SYNTHETIC_SETUP_EXISTS_REVIEW_REQUIRED');
  const id=randomBytes(8).toString('hex'),{privateKey}=await generateKeyPair('ES256',{extractable:true});
  state=validate({schemaVersion:1,id,databaseName:`crest_migrate_${id}`,databaseContainer:`crest-synthetic-db-${id}`,authContainer:`crest-synthetic-auth-${id}`,volume:`crest-synthetic-data-${id}`,issuer,origin,databasePassword:randomBytes(32).toString('hex'),login:`crest_local_${id}`,loginPassword:randomBytes(32).toString('hex'),publicKey:`sb_publishable_${randomBytes(24).toString('base64url')}`,jwtSecret:randomBytes(48).toString('base64url'),jwk:{...await exportJWK(privateKey),kid:randomUUID(),alg:'ES256',use:'sig',key_ops:['sign','verify']},loginKey:randomBytes(32).toString('base64url'),tokenKey:randomBytes(32).toString('base64url')});
  await save(join(directory,'initializing.json'),{schemaVersion:1,id,startedAt:new Date().toISOString()});
  await save(join(directory,'provisioning-private.json'),state);
  stage='database container';
  assert.equal(docker(['volume','ls','--filter',`name=^${state.volume}$`,'--format','{{.Name}}']),'','SYNTHETIC_VOLUME_ALREADY_EXISTS');
  docker(['volume','create','--label',`crest.synthetic-workspace=${id}`,state.volume]);
  docker(['create','--name',state.databaseContainer,'--label',`crest.synthetic-workspace=${id}`,'--publish','127.0.0.1:54329:5432','--publish','127.0.0.1:54327:9999','--mount',`type=volume,source=${state.volume},target=/var/lib/postgresql/data`,'--env','POSTGRES_USER=supabase_admin','--env','POSTGRES_DB=crest_test','--env','POSTGRES_PASSWORD','--log-driver','none',pins.testDatabaseImage],{POSTGRES_PASSWORD:state.databasePassword});
  docker(['start',state.databaseContainer]);await healthy(state);
  stage='database connection';
  const admin=new pg.Client({connectionString:`postgresql://supabase_admin:${state.databasePassword}@127.0.0.1:54329/crest_test`});await admin.connect();
  try{await admin.query(`CREATE DATABASE "${state.databaseName}" TEMPLATE template0`);}finally{await admin.end();}
  stage='empty migration bootstrap';
  await applySyntheticMigrations({root,directory,state,bootstrap:true});
  const db=await database(state);
  try{
   await db.query('CREATE SCHEMA auth AUTHORIZATION supabase_auth_admin');await db.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');await db.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
   const providerDatabase=new URL(connection(state));providerDatabase.port='5432';providerDatabase.searchParams.set('options','-c role=supabase_auth_admin -c search_path=auth,public');
   const env={GOTRUE_DB_DATABASE_URL:providerDatabase.toString(),GOTRUE_DB_DRIVER:'postgres',GOTRUE_DB_NAMESPACE:'auth',GOTRUE_SITE_URL:origin,API_EXTERNAL_URL:issuer,GOTRUE_JWT_SECRET:state.jwtSecret,GOTRUE_LOG_LEVEL:'error'};
   stage='provider migrations';
   docker(['run','--rm','--network',`container:${state.databaseContainer}`,...Object.keys(env).flatMap(key=>['--env',key]),pins.testAuthImage,'auth','migrate'],env);
   assert.equal((await db.query('SELECT max(version) AS v FROM auth.schema_migrations')).rows[0].v,'20260831180000');
   stage='registered application migrations';
   await applySyntheticMigrations({root,directory,state});
   await db.query(`CREATE ROLE ${state.login} LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${state.loginPassword}'`);await db.query(`GRANT crest_web TO ${state.login}`);
   const authEnv={...env,GOTRUE_API_HOST:'0.0.0.0',GOTRUE_API_PORT:'9999',GOTRUE_JWT_KEYS:JSON.stringify([state.jwk]),GOTRUE_JWT_ISSUER:issuer,GOTRUE_JWT_AUD:'authenticated',GOTRUE_JWT_DEFAULT_GROUP_NAME:'authenticated',GOTRUE_JWT_EXP:'3600',GOTRUE_DISABLE_SIGNUP:'true',GOTRUE_EXTERNAL_EMAIL_ENABLED:'true',GOTRUE_MAILER_AUTOCONFIRM:'false',GOTRUE_MFA_TOTP_ENROLL_ENABLED:'true',GOTRUE_MFA_TOTP_VERIFY_ENABLED:'true',GOTRUE_SESSIONS_SINGLE_PER_USER:'false'};
   docker(['create','--name',state.authContainer,'--label',`crest.synthetic-workspace=${id}`,'--network',`container:${state.databaseContainer}`,'--read-only','--tmpfs','/tmp','--cap-drop','ALL','--security-opt','no-new-privileges','--log-driver','none',...Object.keys(authEnv).flatMap(key=>['--env',key]),pins.testAuthImage,'auth','serve'],authEnv);
   stage='provider startup';
   docker(['start',state.authContainer]);await authHealthy();server=await bridge();
   const signingKey=await importSyntheticSigningKey(state.jwk);
   const jwt=await new SignJWT({role:'service_role',aud:'authenticated',iss:issuer}).setProtectedHeader({alg:'ES256',kid:state.jwk.kid,typ:'JWT'}).setIssuedAt().setExpirationTime('5m').sign(signingKey);
   stage='synthetic owner enrollment';
   const adminSdk=client(jwt),sdk=client();await adminSdk.initialize();await sdk.initialize();
   try{
    const email=`crest-synthetic-${id}@example.com`,password=randomBytes(24).toString('base64url');
    const user=result(await adminSdk.admin.createUser({email,password,email_confirm:true})).user;assert(user?.id);
    result(await sdk.signInWithPassword({email,password}));const factor=result(await sdk.mfa.enroll({factorType:'totp',friendlyName:'Crest local synthetic workspace'})),totp=URI.parse(factor.totp.uri);
    result(await sdk.mfa.challengeAndVerify({factorId:factor.id,code:totp.generate()}));
    state.owner={subject:user.id,factorId:factor.id};
    const bootstrap=(await db.query("SELECT id FROM crest_private.actors WHERE system_key='security_bootstrap'")).rows[0].id;
    await db.query('BEGIN');try{
     const actor=(await db.query("INSERT INTO crest_private.actors(kind,display_label,auth_provider_issuer,auth_user_id,created_by,updated_by,origin) VALUES('owner','Synthetic workspace owner',$1,$2,$3,$3,'manual') RETURNING id",[issuer,user.id,bootstrap])).rows[0].id;
     state.businessId=(await db.query("INSERT INTO crest.businesses(legal_name,timezone,created_by,updated_by,origin) VALUES('Synthetic Crest workshop','America/Indianapolis',$1,$1,'manual') RETURNING id",[actor])).rows[0].id;
     await db.query("INSERT INTO crest.memberships(business_id,actor_id,role,created_by,updated_by,origin) VALUES($1,$2,'owner',$2,$2,'manual')",[state.businessId,actor]);
     await db.query("INSERT INTO crest_private.business_recovery_authorities(business_id,created_by,updated_by,origin) VALUES($1,$2,$2,'manual')",[state.businessId,actor]);
     // Explicitly enables ONLY this newly created synthetic business, not a real-use release.
     await db.query('UPDATE crest_private.business_recovery_authorities SET writes_enabled=true,version=version+1 WHERE business_id=$1',[state.businessId]);await db.query('COMMIT');
    }catch{await db.query('ROLLBACK');throw Error('SYNTHETIC_OWNER_BOOTSTRAP_FAILED');}
    await save(join(directory,'owner-credentials.json'),{purpose:'Fictional local testing only. Never use these credentials elsewhere.',email,password,totpUri:factor.totp.uri});
   }finally{await sdk.dispose();await adminSdk.dispose();}
   // Generate a local certificate inside the owned container. No host trust-store edits.
   stage='local TLS';
   docker(['exec',state.databaseContainer,'openssl','req','-x509','-newkey','rsa:2048','-noenc','-keyout','/tmp/crest-synthetic.key','-out','/tmp/crest-synthetic.pem','-days','30','-subj','/CN=localhost','-addext','subjectAltName=IP:127.0.0.1,DNS:localhost']);
   docker(['cp',`${state.databaseContainer}:/tmp/crest-synthetic.key`,join(directory,'tls.key')]);docker(['cp',`${state.databaseContainer}:/tmp/crest-synthetic.pem`,join(directory,'tls.pem')]);
   state.certificateSha256=createHash('sha256').update(await readFile(join(directory,'tls.pem'))).digest('hex');await save(statePath,state);
  }finally{await db.end();if(server){server.closeAllConnections();await new Promise(ok=>server.close(ok));server=null;}}
  console.log('Synthetic workspace initialized. Private sign-in details are in .local/synthetic-workspace/owner-credentials.json. No credentials printed. Start explicitly with workspace:start.');
 }else{
  state=validate(JSON.parse(await readFile(statePath,'utf8')));ownContainer(state,state.databaseContainer);ownContainer(state,state.authContainer);
  if(mode==='stop'){docker(['stop','--time','10',state.authContainer,state.databaseContainer]);console.log('Owned synthetic services stopped. Persistent data retained.');}
  else{
   docker(['start',state.databaseContainer]);await healthy(state);docker(['start',state.authContainer]);await authHealthy();server=await bridge();
   process.env.NODE_ENV='production';
   const {createCrestApplication,createAuthenticationRuntime}=await import('../.local/server/application.mjs');
   const runtime=await createAuthenticationRuntime({database:{connectionString:connection(state,true),environment:'test'},provider:{issuer,publicKey:state.publicKey,environment:'test'},owner:state.owner,loginKey:Buffer.from(state.loginKey,'base64url'),ingress:{kind:'direct'},activeKeyId:'synthetic',keys:[{id:'synthetic',key:Buffer.from(state.tokenKey,'base64url')}]});
   const cert=await readFile(join(directory,'tls.pem'));assert.equal(createHash('sha256').update(cert).digest('hex'),state.certificateSha256);
   app=await createCrestApplication({origin,environment:'test',tls:{key:await readFile(join(directory,'tls.key')),cert},authentication:runtime.forServer(),business:{businessId:state.businessId},customers:true,vehicles:true,associations:true,leads:true,leadConversions:true,operationResolution:true,syntheticCatalog:true});
   await new Promise((ok,no)=>{app.server.once('error',no);app.server.listen(4319,'127.0.0.1',ok);});
   console.log('Synthetic Crest workspace: '+origin+' . Genuine sign-in required; self-signed local TLS, no automatic browser exception. Data lives in the owned Docker volume.');
   const close=async()=>{await app.close();server.closeAllConnections();await new Promise(ok=>server.close(ok));process.exit(0);};process.once('SIGINT',close);process.once('SIGTERM',close);
  }
 }
}catch(error){
 // Child/provider/database messages and causes may contain private configuration.
 if(app)await app.close().catch(()=>undefined);if(server){server.closeAllConnections();server.close();}
 const code=typeof error.code==='string'&&/^(?:[A-Z_]{2,40}|[0-9A-Z]{5})$/.test(error.code)?error.code:typeof error.message==='string'&&/^[A-Z][A-Z_]{2,80}$/.test(error.message)?error.message:'unclassified';
 console.error('SYNTHETIC_WORKSPACE_FAILED at '+stage+' ('+code+'): '+(error instanceof assert.AssertionError?'precondition requires review':'setup/start requires review')+'. Existing data was not deleted or reset.');process.exitCode=1;
}
