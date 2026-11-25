// Compatibility is an explicit pair, never a numeric range or auto-adoption.
import {recoveryRoutineBaseline138} from './recovery-routine-baseline138.ts';
import {recoverySchemaBaseline138} from './recovery-schema-baseline138.ts';
import {recoveryRoutineBaseline139} from './recovery-routine-baseline139.ts';
import {recoverySchemaBaseline139} from './recovery-schema-baseline139.ts';
import {openingFunds139SourceProfile} from './opening-funds139-catalog.ts';
import {recoveryRoutineBaseline140} from './recovery-routine-baseline140.ts';
import {recoverySchemaBaseline140} from './recovery-schema-baseline140.ts';
import {openingSupplier141SourceProfile} from './opening-supplier141-catalog.ts';
import {openingDocument142SourceProfile} from './opening-document142-catalog.ts';
const supplier141Routines=Object.freeze({profile:'crest.application-routine-catalog.v1' as const,sourceSchemaVersion:141 as const,migrationRegistrySha256:openingSupplier141SourceProfile.migrationRegistrySha256,routineCount:openingSupplier141SourceProfile.routineCount,sha256:openingSupplier141SourceProfile.routineSha256});
const supplier141Schema=Object.freeze({profile:'crest.application-schema-catalog.v1' as const,sourceSchemaVersion:141 as const,migrationRegistrySha256:openingSupplier141SourceProfile.migrationRegistrySha256,objectCount:openingSupplier141SourceProfile.schemaObjectCount,sha256:openingSupplier141SourceProfile.schemaSha256});
const document142Routines=Object.freeze({profile:'crest.application-routine-catalog.v1' as const,sourceSchemaVersion:142 as const,migrationRegistrySha256:openingDocument142SourceProfile.migrationRegistrySha256,routineCount:openingDocument142SourceProfile.routineCount,sha256:openingDocument142SourceProfile.routineSha256});
const document142Schema=Object.freeze({profile:'crest.application-schema-catalog.v1' as const,sourceSchemaVersion:142 as const,migrationRegistrySha256:openingDocument142SourceProfile.migrationRegistrySha256,objectCount:openingDocument142SourceProfile.schemaObjectCount,sha256:openingDocument142SourceProfile.schemaSha256});
export type RecoverySourceSchemaVersion=138|139|140|141|142;
export function recoverySourceProfileMatches(version:unknown,registry:unknown):version is RecoverySourceSchemaVersion{
 return typeof registry==='string'&&/^[a-f0-9]{64}$/.test(registry)&&(version===138||version===139&&registry===openingFunds139SourceProfile.migrationRegistrySha256||version===140&&registry===recoveryRoutineBaseline140.migrationRegistrySha256||version===141&&registry===openingSupplier141SourceProfile.migrationRegistrySha256||version===142&&registry===openingDocument142SourceProfile.migrationRegistrySha256);
}
export function recoveryCanonicalSourceProfile(version:unknown,registry:unknown){
 if(version===138&&registry===recoveryRoutineBaseline138.migrationRegistrySha256)return Object.freeze({routines:recoveryRoutineBaseline138,schema:recoverySchemaBaseline138,registered:true});
 if(version===139&&registry===recoveryRoutineBaseline139.migrationRegistrySha256)return Object.freeze({routines:recoveryRoutineBaseline139,schema:recoverySchemaBaseline139,registered:true});
 if(version===140&&registry===recoveryRoutineBaseline140.migrationRegistrySha256)return Object.freeze({routines:recoveryRoutineBaseline140,schema:recoverySchemaBaseline140,registered:true});
 // Exact coherent141 source registration; installation/reopening remain separate.
 if(version===141&&registry===openingSupplier141SourceProfile.migrationRegistrySha256)return Object.freeze({routines:supplier141Routines,schema:supplier141Schema,registered:true});
 if(version===142&&registry===openingDocument142SourceProfile.migrationRegistrySha256)return Object.freeze({routines:document142Routines,schema:document142Schema,registered:true});
 throw Error('RECOVERY_SOURCE_PROFILE_REQUIRED');
}
