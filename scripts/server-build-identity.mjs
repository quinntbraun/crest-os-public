import {createHash} from 'node:crypto';
import {lstat,readdir,readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join,relative,sep} from 'node:path';
import {validateMigrationSet} from '../src/tooling/migrations.ts';
const sha=value=>createHash('sha256').update(value).digest('hex');
export async function serverBuildIdentity(root=new URL('../',import.meta.url)){
 const directory=fileURLToPath(root),paths=[];
 async function collect(name){
  const path=join(directory,name),info=await lstat(path);if(info.isSymbolicLink())throw Error('BUILD_IDENTITY_SOURCE_REQUIRED');
  if(info.isDirectory())for(const entry of (await readdir(path)).sort())await collect(join(name,entry));
  else if(info.isFile())paths.push(relative(directory,path).split(sep).join('/'));
  else throw Error('BUILD_IDENTITY_SOURCE_REQUIRED');
 }
 for(const name of ['src','public','release/compatibility.json','release/toolchain.json','release/third-party','supabase/migrations','supabase/migration-checksums.json','package.json','package-lock.json','.npmrc','next.config.ts','next-env.d.ts','tsconfig.json','Dockerfile',
  'scripts/build-server.mjs','scripts/server-build-identity.mjs','scripts/install-pdf-tools.mjs','scripts/install-heic-tools.mjs','scripts/fetch-release-asset.mjs'])await collect(name);
 const registryBytes=await readFile(join(directory,'supabase/migration-checksums.json')),registry=JSON.parse(registryBytes.toString('utf8'));
 const migrations=new Map();for(const name of await readdir(join(directory,'supabase/migrations')))if(name.endsWith('.sql'))migrations.set(name,await readFile(join(directory,'supabase/migrations',name)));
 validateMigrationSet(registry,migrations);
 const compatibility=JSON.parse(await readFile(join(directory,'release/compatibility.json'),'utf8'));
 if(compatibility.schemaMaximum!==registry.migrations.length)throw Error('BUILD_IDENTITY_SCHEMA_REQUIRED');
 const files=[];for(const name of paths.sort()){const bytes=await readFile(join(directory,name));files.push({path:name,bytes:bytes.length,sha256:sha(bytes)});}
 const sourceContentSha256=sha(JSON.stringify(files));
 return Object.freeze({schemaVersion:1,appReleaseId:sourceContentSha256.slice(0,40),sourceContentSha256,migrationRegistrySha256:sha(registryBytes),sourceSchemaVersion:registry.migrations.length});
}
