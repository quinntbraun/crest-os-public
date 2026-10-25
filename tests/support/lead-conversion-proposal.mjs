// Synthetic, disposable proposal history. Never modifies the registered prefix.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {cp,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';

export async function leadConversionProposal(sandbox) {
 const prefix=await sandbox.prefix(40),directory=join(sandbox.workspace,'conversion-proposal41');
 await cp(prefix,directory,{recursive:true,errorOnExist:true,force:false});
 const path=join(directory,'supabase/migration-checksums.json');
 const registry=JSON.parse(await readFile(path,'utf8'));
 assert.equal(registry.migrations.length,40);
 const bytes=await readFile(join(sandbox.root,'planning/proposals/lead-conversion.sql'));
 const file='20261025180000_lead_conversion.sql';
 registry.migrations.push({version:file.slice(0,14),file,sha256:createHash('sha256').update(bytes).digest('hex')});
 await writeFile(join(directory,'supabase/migrations',file),bytes);
 await writeFile(path,JSON.stringify(registry)+'\n');
 return {prefix,directory};
}
