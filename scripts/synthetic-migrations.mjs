// Narrow local Linux runner: public migration inputs/dependencies are copied;
// private workspace configuration is never mounted. Only the generated local
// synthetic database credential is supplied to this explicit construction task.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {cp,mkdir,readFile,writeFile,copyFile} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {createRequire} from 'node:module';
import pg from 'pg';

export async function requireSyntheticJobCompletion(connectionString){
 await requireSyntheticReader(connectionString,'crest_commands.read_job_completion_context(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid)','SYNTHETIC_JOB_COMPLETION_MIGRATION_REQUIRED');
}

export async function requireSyntheticJobMileage(connectionString){
 await requireSyntheticReader(connectionString,'crest_commands.read_job_mileage_trips(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,timestamptz,uuid,integer)','SYNTHETIC_JOB_MILEAGE_MIGRATION_REQUIRED');
}

export async function requireSyntheticSupportTrips(connectionString){
 for(const signature of [
  'read_support_trips(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,timestamptz,uuid,integer)',
  'read_support_trip_history(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,bigint,bigint,integer)',
  'read_support_trip_mileage(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid)'
 ])await requireSyntheticReader(connectionString,'crest_commands.'+signature,'SYNTHETIC_SUPPORT_TRIP_MIGRATION_REQUIRED');
}

async function requireSyntheticReader(connectionString,signature,missing){
 const client=new pg.Client({connectionString,connectionTimeoutMillis:5000,statement_timeout:5000});
 try{
  await client.connect();
  await client.query('SET ROLE crest_web');
  const {rows}=await client.query("SELECT has_function_privilege(to_regprocedure($1),'EXECUTE') AS available",[signature]);
  assert(rows[0]?.available===true,missing);
 }finally{await client.end();}
}

// Resolve the existing installed closure from the checkout's package context.
// Worktrees may share their ancestor's locked installation. Do not mount that
// ancestor or copy unrelated packages/private workspace state into the runner.
export async function copySyntheticPgDependencies({root,output}){
 const require=createRequire(join(root,'package.json')),copied=new Map();
 async function dependency(name,parentRequire=require){
  assert(/^(?:@[a-z0-9-]+\/)?[a-z0-9-]+$/.test(name));
  let source=dirname(parentRequire.resolve(name)),pkg;
  for(let depth=0;depth<8;depth++){
   try{const candidate=JSON.parse(await readFile(join(source,'package.json'),'utf8'));if(candidate.name===name){pkg=candidate;break;}}
   catch(error){if(error.code!=='ENOENT')throw error;}
   const parent=dirname(source);if(parent===source)break;source=parent;
  }
  assert(pkg,'SYNTHETIC_DEPENDENCY_PACKAGE_REQUIRED');
  // This narrow flattened closure must not silently substitute another nested
  // version. A future conflicting lockfile graph requires explicit review.
  if(copied.has(name)){assert.equal(copied.get(name),source,'SYNTHETIC_DEPENDENCY_CONFLICT');return;}
  copied.set(name,source);await cp(source,join(output,'node_modules',name),{recursive:true});
  const next=createRequire(join(source,'package.json'));
  for(const child of Object.keys(pkg.dependencies??{}))await dependency(child,next);
 }
 await dependency('pg');
}

export async function applySyntheticMigrations({root,directory,state,bootstrap=false}){
 assert(/^[a-f0-9]{16}$/.test(state.id)&&state.databaseContainer===`crest-synthetic-db-${state.id}`&&state.databaseName===`crest_migrate_${state.id}`);
 const input=join(directory,bootstrap?'public-bootstrap-input':'public-migration-input'),tools=join(directory,'linux-tools'),ledger=join(directory,'migration-ledger');
 await mkdir(join(input,'src/tooling'),{recursive:true,mode:0o700});await mkdir(join(input,'supabase/migrations'),{recursive:true});await mkdir(join(input,'node_modules'),{recursive:true});await mkdir(tools,{recursive:true});await mkdir(ledger,{recursive:true});
 for(const file of ['migration-coordinator.ts','migrations.ts','migration-cli-diagnostic.ts'])await copyFile(join(root,'src/tooling',file),join(input,'src/tooling',file));
 const registry=JSON.parse(await readFile(join(root,'supabase/migration-checksums.json'),'utf8'));if(bootstrap)registry.migrations=[];
 await writeFile(join(input,'supabase/migration-checksums.json'),JSON.stringify(registry)+'\n');
 for(const entry of registry.migrations)await copyFile(join(root,'supabase/migrations',entry.file),join(input,'supabase/migrations',entry.file));
 // Copy only the locked public pg dependency closure, never application state.
 await copySyntheticPgDependencies({root,output:input});
 const pins=JSON.parse(await readFile(join(root,'release/toolchain.json'),'utf8')),sourceCommit=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();assert(/^[a-f0-9]{40}$/.test(sourceCommit));
 await writeFile(join(input,'package.json'),'{"type":"module"}\n');await writeFile(join(input,'toolchain.json'),JSON.stringify(pins));
 const runner=`import {readFile,writeFile,access} from 'node:fs/promises';import {execFileSync} from 'node:child_process';import {createHash} from 'node:crypto';import {applyTestMigrations} from './src/tooling/migration-coordinator.ts';
const pins=JSON.parse(await readFile('/workspace/toolchain.json','utf8'));
let cached=false;try{const bytes=await readFile('/tools/cli.tar.gz');cached=createHash('sha256').update(bytes).digest('hex')===pins.supabaseCli.linuxAmd64Sha256;}catch{}
if(!cached){const response=await fetch('https://github.com/supabase/cli/releases/download/v'+pins.supabaseCli.version+'/supabase_linux_amd64.tar.gz',{signal:AbortSignal.timeout(120000)});if(!response.ok)throw Error('SYNTHETIC_CLI_DOWNLOAD_FAILED');const bytes=Buffer.from(await response.arrayBuffer());if(createHash('sha256').update(bytes).digest('hex')!==pins.supabaseCli.linuxAmd64Sha256)throw Error('SYNTHETIC_CLI_INTEGRITY_FAILED');await writeFile('/tools/cli.tar.gz',bytes);}
execFileSync('tar',['-xzf','/tools/cli.tar.gz','-C','/tools']);await access('/tools/supabase');
try{const receipt=await applyTestMigrations({environment:'test',connectionString:process.env.CREST_SYNTHETIC_URL,workspace:'/workspace',ledgerRoot:'/ledger',cliPath:'/tools/supabase',sourceCommit:${JSON.stringify(sourceCommit)},bootstrapEmpty:${bootstrap}});console.log('Synthetic migration receipt verified: '+receipt.history.length+' registered migrations.');}catch(error){console.error(typeof error.message==='string'&&/^[A-Z_]+$/.test(error.message)?error.message:'SYNTHETIC_MIGRATIONS_FAILED');process.exitCode=1;}`;
 await writeFile(join(input,'run.mjs'),runner);
 const url=`postgresql://supabase_admin:${state.databasePassword}@127.0.0.1:5432/${state.databaseName}`;
 execFileSync('docker',['run','--rm','--network',`container:${state.databaseContainer}`,'--mount',`type=bind,source=${input},target=/workspace,readonly`,'--mount',`type=bind,source=${tools},target=/tools`,'--mount',`type=bind,source=${ledger},target=/ledger`,'--workdir','/workspace','--env','CREST_SYNTHETIC_URL',pins.nodeImage,'node','run.mjs'],{env:{...process.env,CREST_SYNTHETIC_URL:url},stdio:['ignore','pipe','pipe'],timeout:180000,maxBuffer:2*1024*1024});
}
