// Fresh-process synthetic restore. No source DB URL or original source process
// state is accepted. Explicit loopback vault credentials are fixture-only.
import {readFile,writeFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {resolve,dirname,isAbsolute} from 'node:path';
import {S3Client} from '@aws-sdk/client-s3';
import {createRecoveryVault} from '../../src/tooling/recovery-vault.ts';
import {createRecoveryRunRestore} from '../../src/tooling/recovery-run-restore.ts';
let client;
try{
 if(process.env.CREST_ENV!=='test'||process.env.CREST_TEST_DATABASE_URL||process.env.PGDATABASE||process.env.PGPASSWORD)throw Error('TEST_ONLY_CLOSED_RESTORE_REQUIRED');
 const bytes=await readFile(process.argv[2]);if(bytes.length>2097152)throw Error('BOUNDED_FIXTURE_REQUIRED');const input=JSON.parse(bytes.toString('utf8'));bytes.fill(0);const endpoint=new URL(input.endpoint);if(endpoint.protocol!=='http:'||endpoint.hostname!=='127.0.0.1'||!endpoint.port||endpoint.pathname!=='/'||endpoint.username||endpoint.password||endpoint.search||endpoint.hash||!isAbsolute(input.age)||dirname(resolve(input.output))!==resolve(input.workspace))throw Error('OWNED_FIXTURE_REQUIRED');
 client=new S3Client({region:'auto',endpoint:input.endpoint,forcePathStyle:true,maxAttempts:1,credentials:input.credentials,requestChecksumCalculation:'WHEN_REQUIRED',responseChecksumValidation:'WHEN_REQUIRED'});const vault=createRecoveryVault(client,'crest-test-vault',10000),restore=createRecoveryRunRestore((command,args,env)=>{if(command!=='age')throw Error('AGE_ONLY');return spawn(input.age,args,{env:{...env,NODE_ENV:'test'},stdio:['pipe','pipe','pipe'],windowsHide:true});});
 const result=await restore({candidateSource:input.candidateSource,expected:input.expected,workspace:input.workspace,identityFile:input.identityFile},vault,new AbortController().signal);await writeFile(input.output,JSON.stringify(result.forRecoveryTools())+'\n',{flag:'wx',mode:0o600});
}catch(error){const stage=error?.name==='RecoveryRunRestoreError'?error.stage:'fixture';console.error(JSON.stringify({error:'FRESH_RECOVERY_RESTORE_REFUSED',stage}));process.exitCode=1;}finally{client?.destroy();}
