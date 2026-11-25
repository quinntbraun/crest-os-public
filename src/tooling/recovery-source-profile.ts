// Compatibility is an explicit pair, never a numeric range or auto-adoption.
import {recoveryRoutineBaseline138} from './recovery-routine-baseline138.ts';
import {recoverySchemaBaseline138} from './recovery-schema-baseline138.ts';
import {recoveryRoutineBaseline139} from './recovery-routine-baseline139.ts';
import {recoverySchemaBaseline139} from './recovery-schema-baseline139.ts';
import {openingFunds139SourceProfile} from './opening-funds139-catalog.ts';
import {recoveryRoutineBaseline140} from './recovery-routine-baseline140.ts';
import {recoverySchemaBaseline140} from './recovery-schema-baseline140.ts';
export type RecoverySourceSchemaVersion=138|139|140;
export function recoverySourceProfileMatches(version:unknown,registry:unknown):version is RecoverySourceSchemaVersion{
 return typeof registry==='string'&&/^[a-f0-9]{64}$/.test(registry)&&(version===138||version===139&&registry===openingFunds139SourceProfile.migrationRegistrySha256||version===140&&registry===recoveryRoutineBaseline140.migrationRegistrySha256);
}
export function recoveryCanonicalSourceProfile(version:unknown,registry:unknown){
 if(version===138&&registry===recoveryRoutineBaseline138.migrationRegistrySha256)return Object.freeze({routines:recoveryRoutineBaseline138,schema:recoverySchemaBaseline138,registered:true});
 if(version===139&&registry===recoveryRoutineBaseline139.migrationRegistrySha256)return Object.freeze({routines:recoveryRoutineBaseline139,schema:recoverySchemaBaseline139,registered:true});
 if(version===140&&registry===recoveryRoutineBaseline140.migrationRegistrySha256)return Object.freeze({routines:recoveryRoutineBaseline140,schema:recoverySchemaBaseline140,registered:true});
 throw Error('RECOVERY_SOURCE_PROFILE_REQUIRED');
}
