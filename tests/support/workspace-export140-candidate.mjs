// Isolated proposed migration. No root registry, production or account changes.
import assert from 'node:assert/strict';
import {readFile,writeFile,cp} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
export async function workspaceExport140Candidate(sandbox){
 const active=await readFile(join(sandbox.root,'supabase/migration-checksums.json'));assert(['1925b449bd75ebe9dd3a9a01b55f7eb0f33f993a88dfca5b96b55b4fbc0f7a7a','823ffc623e93cc0f2c6122b6a04a47b5b1c776dbd6d9c0f779211869f5e75234','7bcd4b1b7374f163442c2528ccd4984020f0cadadea0ac3d38f36cf66facf4eb','3d215728bdcf52da73eefe4f1c4a6a5bcb682cbd947b178939f1d7175add5279'].includes(createHash('sha256').update(active).digest('hex')));
 const before=await readFile(join(sandbox.root,'tests/support/registered139-migration-checksums.json'));
 assert.equal(createHash('sha256').update(before).digest('hex'),'1925b449bd75ebe9dd3a9a01b55f7eb0f33f993a88dfca5b96b55b4fbc0f7a7a');
 const registry=JSON.parse(before);assert.equal(registry.migrations.length,139);assert.deepEqual(JSON.parse(active).migrations.slice(0,139),registry.migrations);
 const source=await readFile(join(sandbox.root,'planning/proposals/20270206180000_opening_funds_workspace_export.sql'));
 const file='20270206183000_opening_funds_workspace_export.sql',sha256=createHash('sha256').update(source).digest('hex'),frozen=await sandbox.prefix(139),directory=join(sandbox.workspace,'workspace-export140-candidate');
 await cp(join(frozen,'supabase'),join(directory,'supabase'),{recursive:true,force:false,errorOnExist:true});
 registry.migrations.push({version:'20270206183000',file,sha256});const bytes=JSON.stringify(registry,null,2)+'\n';
 await writeFile(join(directory,'supabase/migrations',file),source,{flag:'wx'});await writeFile(join(directory,'supabase/migration-checksums.json'),bytes);
 const coverage=JSON.parse(await readFile(join(sandbox.root,'tests/support/registered139-security-export-coverage.json'),'utf8'));coverage.migrationCount=140;
 return Object.freeze({directory,registry,file,coverage,sha256,registrySha256:createHash('sha256').update(bytes).digest('hex'),registered:false});
}
