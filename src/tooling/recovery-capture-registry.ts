// Fixed reviewed registry pairs only. Parsing a registry never authorizes a
// database upgrade, production reopening or a completed-backup claim.
import {createHash} from 'node:crypto';
import {parseRecoveryJson} from './recovery-json.ts';
import {recoveryCanonicalSourceProfile} from './recovery-source-profile.ts';
import type {RecoverySourceSchemaVersion} from './recovery-source-profile.ts';
export function readRecoveryCaptureRegistry(bytes:Uint8Array){
 const registrySha256=createHash('sha256').update(bytes).digest('hex');
 const parsed=parseRecoveryJson(Buffer.from(bytes).toString('utf8'),262144) as {migrations?:unknown};
 if(!Array.isArray(parsed.migrations))throw Error('RECOVERY_CAPTURE_REGISTRY_REQUIRED');
 const sourceSchemaVersion=parsed.migrations.length;
 recoveryCanonicalSourceProfile(sourceSchemaVersion,registrySha256);
 const migrations=parsed.migrations.map((row:unknown)=>{
  if(!row||typeof row!=='object'||!('version'in row)||!('file'in row)||typeof row.version!=='string'||typeof row.file!=='string'
   ||!/^\d{14}$/.test(row.version)||!row.file.startsWith(row.version+'_')||!row.file.endsWith('.sql'))throw Error('RECOVERY_CAPTURE_REGISTRY_REQUIRED');
  return Object.freeze({version:row.version,name:row.file.slice(15,-4)});
 });
 return Object.freeze({sourceSchemaVersion:sourceSchemaVersion as RecoverySourceSchemaVersion,registrySha256,migrations:Object.freeze(migrations)});
}
