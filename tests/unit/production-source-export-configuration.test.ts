import {randomBytes,randomUUID} from 'node:crypto';
import {it,expect,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {parseProductionSourceExportConfiguration} from '../../src/server/production-source-export-configuration';
import {openProductionSourceExportRuntime,sourceExportRuntimeBelongsTo} from '../../src/server/production-source-export-runtime';
import {createProductionCapabilities} from '../../src/security/production-capabilities';
function config(){return {connectionString:'postgresql://crest_source_export:fixture-only@database.example.com/crest',storage:{accountId:'a'.repeat(32),bucket:'crest-private-exports',accessKeyId:'fixture-only-export-access',secretAccessKey:'fixture-only-export-secret'},activeKeyId:'current',keys:[{id:'current',key:randomBytes(32).toString('base64url')}]};}
it('rejects ambiguous keys and user-selected storage endpoints, release identities and schema aliases',()=>{
 const value=config();expect(Object.isFrozen(parseProductionSourceExportConfiguration(value))).toBe(true);
 for(const bad of [{...value,sourceSchemaVersion:134},{...value,storage:{...value.storage,endpoint:'https://other.example.com'}},{...value,activeKeyId:'missing'},{...value,keys:[...value.keys,...value.keys]},{...value,keys:[{id:'current',key:'bad'}]}])expect(()=>parseProductionSourceExportConfiguration(bad)).toThrow('PRODUCTION_SOURCE_EXPORT_CONFIGURATION_REQUIRED');
});
it('requires an actual compiled identity before opening production source export resources',async()=>{
 const businessId=randomUUID(),capabilities=createProductionCapabilities({productionActivation:'ready'},businessId,['operationResolution','businessExports']);
 await expect(openProductionSourceExportRuntime(config(),businessId,{} as never,capabilities)).rejects.toThrow('PRODUCTION_SOURCE_EXPORT_CONFIGURATION_REQUIRED');
 expect(sourceExportRuntimeBelongsTo({belongsTo:()=>true,appReleaseId:'a'.repeat(40)},businessId,'a'.repeat(40))).toBe(false);
});
