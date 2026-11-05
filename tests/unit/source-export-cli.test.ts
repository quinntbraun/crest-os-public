import {mkdtemp,writeFile,readFile,mkdir,symlink,rm,truncate} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,dirname,basename} from 'node:path';
import {spawnSync} from 'node:child_process';
import {it,expect,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {formatBusinessSourceBundle} from '../../src/security/business-source-bundle.ts';
import {businessSourceFixture} from '../support/business-source-fixture.ts';

async function fixture(work:(directory:string,businessId:string)=>Promise<void>){
 const taskTempRoot=resolve(tmpdir()),directory=await mkdtemp(join(taskTempRoot,'crest-synthetic-export-'));
 expect(dirname(resolve(directory))).toBe(taskTempRoot);expect(basename(directory)).toMatch(/^crest-synthetic-export-/);
 try{const f=businessSourceFixture(),value=formatBusinessSourceBundle(f.seal(),f.expected).forServer();await writeFile(join(directory,'source_manifest.json'),value.manifest);for(const part of value.parts)await writeFile(join(directory,part.name),part.content);await work(directory,f.businessId);}finally{await rm(directory,{recursive:true,force:true});}
}
const run=(...args:string[])=>spawnSync(process.execPath,['--conditions=react-server',resolve('scripts/verify-source-export.mjs'),...args],{encoding:'utf8',timeout:10000,maxBuffer:65536,env:{...process.env,HTTP_PROXY:'http://127.0.0.1:1',HTTPS_PROXY:'http://127.0.0.1:1'}});
it('runs a real offline Node process over exact local files and prints only a summary without changing them',async()=>{
 await fixture(async(directory,businessId)=>{
  const before=await readFile(join(directory,'customers.csv')),result=run(directory,businessId,'a'.repeat(40));expect(result.error).toBeUndefined();expect(result.status).toBe(0);expect(result.stderr).toBe('');expect(JSON.parse(result.stdout)).toMatchObject({verified:true,files:94,csvEntities:19,assurance:'internal_consistency_only',completePortableExport:false,completeBackup:false});expect(result.stdout).not.toContain('Private');expect(result.stdout).not.toContain(directory);expect(await readFile(join(directory,'customers.csv'))).toEqual(before);
 });
});
it.each(['corrupt','missing','extra','directory','symlink','oversized','wrong business','bad release','too many args'])('the real offline process refuses %s without leaking private contents or paths',async issue=>{
 await fixture(async(directory,businessId)=>{
  if(issue==='corrupt')await writeFile(join(directory,'customers.csv'),'PRIVATE SENTINEL');if(issue==='missing')await rm(join(directory,'customers.csv'));if(issue==='extra')await writeFile(join(directory,'extra.txt'),'PRIVATE SENTINEL');if(issue==='directory')await mkdir(join(directory,'extra.json'));if(issue==='symlink')await symlink(directory,join(directory,'loop.json'),process.platform==='win32'?'junction':'dir');
  if(issue==='oversized')await truncate(join(directory,'customers.csv'),8*1024*1024+1);
  const result=run(directory,issue==='wrong business'?'00000000-0000-4000-8000-000000000001':businessId,...(issue==='bad release'?['invalid']:issue==='too many args'?['a'.repeat(40),'extra']:[]));
  expect(result.error).toBeUndefined();expect(result.status).toBe(1);expect(result.stdout).toBe('');expect(result.stderr).toBe('SOURCE_EXPORT_REVIEW_REQUIRED\n');
 });
});
