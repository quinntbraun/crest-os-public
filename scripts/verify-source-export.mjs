// Read-only offline profile verifier. No provider, database or network access;
// output is a bounded summary, never private rows, paths or raw exceptions.
import {constants} from 'node:fs';
import {createHash} from 'node:crypto';
import {lstat,open,opendir,realpath,stat} from 'node:fs/promises';
import {resolve,join,dirname} from 'node:path';
import {verifyBusinessSourceBundle} from '../src/security/business-source-verifier.ts';
import {verifyFinanceSourceExport} from '../src/tooling/verify-finance-source-export.ts';

const fail=()=>{throw Error('SOURCE_EXPORT_REVIEW_REQUIRED');};
try{
 const args=process.argv.slice(2);if(args.length<2||args.length>3)fail();
 const [directory,businessId,appReleaseId]=args;
 if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(businessId)||(appReleaseId!==undefined&&!/^[a-f0-9]{40}$/.test(appReleaseId)))fail();
 const root=await realpath(resolve(directory));if(!(await stat(root)).isDirectory())fail();
 const names=[];const dir=await opendir(root);
 for await(const entry of dir){if(!entry.isFile()||entry.isSymbolicLink()
  ||entry.name!=='README.txt'&&!/^[a-z][a-z0-9_]{0,79}\.(csv|json|txt|ndjson)$/.test(entry.name)||names.length>=1025)fail();names.push(entry.name);}
 const finance=names.includes('manifest.json');
 const deliveryName='export_delivery.json';
 if(finance===names.includes('source_manifest.json')||finance&&appReleaseId!==undefined&&!names.includes(deliveryName)
  ||!finance&&names.some(name=>name===deliveryName||name==='README.txt'||name.endsWith('.ndjson')))fail();
 let total=0;
 async function read(name){
  const path=resolve(join(root,name));if(dirname(path)!==root)fail();
  const minimum=finance&&name.endsWith('_history.ndjson')?0n:1n;
  const before=await lstat(path,{bigint:true});if(!before.isFile()||before.isSymbolicLink()||before.size<minimum||before.size>8388608n||total+Number(before.size)>67108864)fail();
  const handle=await open(path,constants.O_RDONLY|(process.platform==='win32'?0:(constants.O_NOFOLLOW??0)));
  try{
   const opened=await handle.stat({bigint:true});if(!opened.isFile()||opened.dev!==before.dev||opened.ino!==before.ino||opened.size!==before.size||opened.mtimeNs!==before.mtimeNs||opened.ctimeNs!==before.ctimeNs)fail();
   const bytes=Buffer.alloc(Number(opened.size)+1);let count=0;
   while(count<bytes.length){const result=await handle.read(bytes,count,bytes.length-count,null);if(result.bytesRead===0)break;count+=result.bytesRead;if(count>Number(opened.size))fail();}
   const after=await handle.stat({bigint:true});if(count!==Number(opened.size)||after.size!==opened.size||after.mtimeNs!==opened.mtimeNs||after.ctimeNs!==opened.ctimeNs)fail();
   total+=count;return bytes.subarray(0,count);
  }finally{await handle.close();}
 }
 const manifestName=finance?'manifest.json':'source_manifest.json';
 const manifest=await read(manifestName),parts=[];
 for(const name of names.filter(name=>name!==manifestName&&name!==deliveryName).sort())parts.push({name,bytes:await read(name)});
 if(finance){
  const decoder=new TextDecoder('utf-8',{fatal:true});
  const manifestText=decoder.decode(manifest);
  const result=verifyFinanceSourceExport(manifestText,parts.map(part=>({name:part.name,content:decoder.decode(part.bytes)})),businessId);
  if(names.includes(deliveryName)){
   const delivery=JSON.parse(decoder.decode(await read(deliveryName)));
   const keys=['schemaVersion','profile','businessId','observedAt','appReleaseId','sourceSchemaVersion','manifestSha256','completePortableExport','completeBackup'];
   if(!delivery||typeof delivery!=='object'||Array.isArray(delivery)||Object.keys(delivery).length!==keys.length
    ||!keys.every(key=>Object.hasOwn(delivery,key))||delivery.schemaVersion!==1
    ||delivery.profile!==result.profile||delivery.businessId!==businessId||delivery.observedAt!==JSON.parse(manifestText).observedAt
    ||typeof delivery.appReleaseId!=='string'||!/^[a-f0-9]{40}$/.test(delivery.appReleaseId)||appReleaseId!==undefined&&delivery.appReleaseId!==appReleaseId
    ||!Number.isSafeInteger(delivery.sourceSchemaVersion)||delivery.sourceSchemaVersion<89||delivery.sourceSchemaVersion>999
    ||delivery.manifestSha256!==createHash('sha256').update(manifest).digest('hex')
    ||delivery.completePortableExport!==false||delivery.completeBackup!==false)fail();
  }
  process.stdout.write(JSON.stringify(result)+'\n');
 }else{
  const result=verifyBusinessSourceBundle({manifest,parts},{businessId,...(appReleaseId===undefined?{}:{appReleaseId})}).forServer();
  process.stdout.write(JSON.stringify({verified:true,profile:'crest.business-source-bundle.v1',sourceSchemaVersion:result.sourceSchemaVersion,files:parts.length,csvEntities:Object.keys(result.rows).length,sourceRecords:Object.values(result.rows).reduce((n,rows)=>n+rows.length,0),assurance:'internal_consistency_only',completePortableExport:false,completeBackup:false})+'\n');
 }
}catch{process.stderr.write('SOURCE_EXPORT_REVIEW_REQUIRED\n');process.exitCode=1;}
