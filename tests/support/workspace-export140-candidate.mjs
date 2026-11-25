// Isolated proposed migration. No root registry, production or account changes.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
export async function workspaceExport140Candidate(sandbox){
 const before=await readFile(join(sandbox.root,'supabase/migration-checksums.json'));
 assert.equal(createHash('sha256').update(before).digest('hex'),'1925b449bd75ebe9dd3a9a01b55f7eb0f33f993a88dfca5b96b55b4fbc0f7a7a');
 const registry=JSON.parse(before);assert.equal(registry.migrations.length,139);
 const source=await readFile(join(sandbox.root,'planning/proposals/20270206180000_opening_funds_workspace_export.sql'));
 const file='20270206183000_opening_funds_workspace_export.sql',sha256=createHash('sha256').update(source).digest('hex'),directory=await sandbox.prefix(139);
 registry.migrations.push({version:'20270206183000',file,sha256});const bytes=JSON.stringify(registry,null,2)+'\n';
 await writeFile(join(directory,'supabase/migrations',file),source,{flag:'wx'});await writeFile(join(directory,'supabase/migration-checksums.json'),bytes);
 return Object.freeze({directory,registry,sha256,registrySha256:createHash('sha256').update(bytes).digest('hex'),registered:false});
}
