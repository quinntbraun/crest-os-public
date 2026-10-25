// Synthetic, disposable proposal history. Never modifies the registered prefix.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {cp,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

async function proposalBytes(root){return Buffer.concat([await readFile(join(root,'planning/proposals/lead-conversion-v2.sql')),Buffer.from('\n'),await readFile(join(root,'planning/proposals/lead-conversion-reads.sql'))]);}
const proposalFile='20261025180000_lead_conversion.sql';
// Independently reconstructed from trusted build sources in the restore child,
// never accepted from a backup manifest or an arbitrary uploaded registry.
export async function leadConversionProposalIdentity(){
 const root=fileURLToPath(new URL('../../',import.meta.url)),registry=JSON.parse(await readFile(join(root,'supabase/migration-checksums.json'),'utf8'));
 assert.equal(registry.migrations.length,40);
 for(const m of registry.migrations)assert.equal(createHash('sha256').update(await readFile(join(root,'supabase/migrations',m.file))).digest('hex'),m.sha256);
 registry.migrations.push({version:proposalFile.slice(0,14),file:proposalFile,sha256:createHash('sha256').update(await proposalBytes(root)).digest('hex')});
 return {schemaVersion:41,registrySha256:createHash('sha256').update(JSON.stringify(registry)+'\n').digest('hex')};
}

export async function leadConversionProposal(sandbox) {
 const prefix=await sandbox.prefix(40),directory=join(sandbox.workspace,'conversion-proposal41');
 await cp(prefix,directory,{recursive:true,errorOnExist:true,force:false});
 const path=join(directory,'supabase/migration-checksums.json');
 const registry=JSON.parse(await readFile(path,'utf8'));
 assert.equal(registry.migrations.length,40);
 // Both published component bodies stay byte-for-byte unchanged. No41 exists
 // in the registered history: the eventual complete candidate must be proved
 // as these exact core bytes + one LF + the additive read/export bytes.
 const bytes=await proposalBytes(sandbox.root);
 const file=proposalFile;
 registry.migrations.push({version:file.slice(0,14),file,sha256:createHash('sha256').update(bytes).digest('hex')});
 await writeFile(join(directory,'supabase/migrations',file),bytes);
 await writeFile(path,JSON.stringify(registry)+'\n');
 return {prefix,directory};
}
