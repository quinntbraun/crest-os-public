import {it,expect} from 'vitest';
import {mkdir,mkdtemp,writeFile,readFile,readdir,access,rm} from 'node:fs/promises';
import {resolve,join,dirname,relative,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {copySyntheticPgDependencies} from '../../scripts/synthetic-migrations.mjs';

async function removeOwnedCase(scope:string,temporary:string){
 const child=relative(scope,temporary);if(dirname(temporary)!==scope||!child.startsWith('case-')||child.includes('..')||isAbsolute(child))throw Error('UNSAFE_TEST_CLEANUP_TARGET');await rm(temporary,{recursive:true,force:true});
}

it('copies a self-contained public pg closure from an ancestor installation without copying checkout state',async()=>{
 const root=fileURLToPath(new URL('../../',import.meta.url)),scope=resolve(root,'.local/synthetic-pg-copy-tests');await mkdir(scope,{recursive:true});const temporary=await mkdtemp(join(scope,'case-'));
 try{
  const checkout=join(temporary,'checkout'),output=join(temporary,'input');await mkdir(checkout);await mkdir(output);await writeFile(join(checkout,'package.json'),'{"name":"synthetic-worktree","type":"module"}');await writeFile(join(checkout,'owner-state.json'),'Synthetic private sentinel: do not copy.');
  await expect(access(join(checkout,'node_modules'))).rejects.toThrow();
  await copySyntheticPgDependencies({root:checkout,output});expect(await readdir(output)).toEqual(['node_modules']);await expect(readFile(join(output,'owner-state.json'),'utf8')).rejects.toThrow();
  const probe=`import assert from 'node:assert/strict';import{createRequire}from'node:module';import{readFileSync,existsSync}from'node:fs';import{dirname,join,relative,isAbsolute,resolve}from'node:path';import pg from 'pg';
const root=resolve('node_modules'),seen=new Set();function visit(name,require=createRequire(resolve('probe.mjs'))){const entry=require.resolve(name),rel=relative(root,entry);assert(rel&&!rel.startsWith('..')&&!isAbsolute(rel),'dependency escaped copied closure');let p=dirname(entry),pkg;for(let n=0;n<8;n++){const f=join(p,'package.json');if(existsSync(f)){const candidate=JSON.parse(readFileSync(f,'utf8'));if(candidate.name===name){pkg=candidate;break;}}p=dirname(p);}assert(pkg);if(seen.has(name))return;seen.add(name);for(const child of Object.keys(pkg.dependencies??{}))visit(child,createRequire(join(p,'package.json')));}visit('pg');assert.equal(typeof pg.Client,'function');assert.equal(typeof pg.Pool,'function');console.log('SYNTHETIC_PG_COPY_OK');`;
  await writeFile(join(output,'package.json'),'{"type":"module"}');await writeFile(join(output,'probe.mjs'),probe);
  expect(execFileSync(process.execPath,['probe.mjs'],{cwd:output,encoding:'utf8',timeout:15000,stdio:['ignore','pipe','pipe']})).toBe('SYNTHETIC_PG_COPY_OK\n');
 }finally{
  // Delete only this verified generated test directory, never a computed parent.
  await removeOwnedCase(scope,temporary);
 }
});
