// Narrow local Linux runner: public migration inputs/dependencies are copied;
// private workspace configuration is never mounted. Only the generated local
// synthetic database credential is supplied to this explicit construction task.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {cp,mkdir,readFile,writeFile,copyFile} from 'node:fs/promises';
import {join} from 'node:path';

export async function applySyntheticMigrations({root,directory,state,bootstrap=false}){
 assert(/^[a-f0-9]{16}$/.test(state.id)&&state.databaseContainer===`crest-synthetic-db-${state.id}`&&state.databaseName===`crest_migrate_${state.id}`);
 const input=join(directory,bootstrap?'public-bootstrap-input':'public-migration-input'),tools=join(directory,'linux-tools'),ledger=join(directory,'migration-ledger');
 await mkdir(join(input,'src/tooling'),{recursive:true,mode:0o700});await mkdir(join(input,'supabase/migrations'),{recursive:true});await mkdir(join(input,'node_modules'),{recursive:true});await mkdir(tools,{recursive:true});await mkdir(ledger,{recursive:true});
 for(const file of ['migration-coordinator.ts','migrations.ts'])await copyFile(join(root,'src/tooling',file),join(input,'src/tooling',file));
 const registry=JSON.parse(await readFile(join(root,'supabase/migration-checksums.json'),'utf8'));if(bootstrap)registry.migrations=[];
 await writeFile(join(input,'supabase/migration-checksums.json'),JSON.stringify(registry)+'\n');
 for(const entry of registry.migrations)await copyFile(join(root,'supabase/migrations',entry.file),join(input,'supabase/migrations',entry.file));
 // Copy only the locked public pg dependency closure, never application state.
 const copied=new Set();async function dependency(name){assert(/^(?:@[a-z0-9-]+\/)?[a-z0-9-]+$/.test(name));if(copied.has(name))return;copied.add(name);const source=join(root,'node_modules',name),pkg=JSON.parse(await readFile(join(source,'package.json'),'utf8'));await cp(source,join(input,'node_modules',name),{recursive:true});for(const child of Object.keys(pkg.dependencies??{}))await dependency(child);}
 await dependency('pg');
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
