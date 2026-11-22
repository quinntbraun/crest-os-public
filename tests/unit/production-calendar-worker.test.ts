import {randomBytes,randomUUID} from 'node:crypto';
import {afterEach,it,expect,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {parseProductionCalendarWorkerProfile} from '../../src/server/production-calendar-worker';
import {createProductionGoogleCalendarWorker,createSyntheticGoogleCalendarWorker} from '../../src/operations/google-calendar-worker';
import {productionGoogleCalendarWorkerDatabase} from '../../src/operations/google-calendar-database';
import {createProductionCapabilities,productionCalendarWorkerBaseCapabilities} from '../../src/security/production-capabilities';

const profile=()=>({schemaVersion:1,businessId:randomUUID(),origin:'https://crest.example.com',connectionString:'postgresql://crest_calendar_runtime:fixture-only@database.example.com/crest',clientId:'crest-owner-client.apps.googleusercontent.com',clientSecret:'fixture-only-client-secret',credentialKeyId:'calendar-grants',calendarKeyMaterial:randomBytes(32).toString('base64url')});
afterEach(()=>vi.unstubAllGlobals());
it('keeps the private worker profile unserializable and refuses actual unaccepted release startup',async()=>{
 const configured=parseProductionCalendarWorkerProfile(JSON.stringify(profile()));expect(Object.keys(configured)).toEqual([]);expect(()=>JSON.stringify(configured)).toThrow('PRODUCTION_CALENDAR_WORKER_CONFIGURATION_REQUIRED');
 await expect(configured.open()).rejects.toThrow('PRODUCTION_CALENDAR_WORKER_CONFIGURATION_REQUIRED');
});
it.each([{origin:'http://crest.example.com'},{origin:'https://crest.example.com/other'},{clientId:'https://elsewhere.example.com'},{clientSecret:'unsafe\nsecret'},{calendarKeyMaterial:'short'},{connectionString:'postgresql://owner:fixture-only@database.example.com/crest?sslmode=disable'},{requestUrl:'https://elsewhere.example.com'}])('rejects unsafe origins, provider identities, key material and additional endpoints',patch=>{
 expect(()=>parseProductionCalendarWorkerProfile(JSON.stringify({...profile(),...patch}))).toThrow('PRODUCTION_CALENDAR_WORKER_CONFIGURATION_REQUIRED');
});
it('constructs the actual production adapters without provider/session success and refuses foreign business before IO',async()=>{
 const input=profile(),config={...input,calendarKeyMaterial:Buffer.from(input.calendarKeyMaterial,'base64url'),environment:'production' as const,productionCapabilities:createProductionCapabilities({productionActivation:'ready'},input.businessId,[...productionCalendarWorkerBaseCapabilities,'googleCalendar'])};
 const request=vi.fn();vi.stubGlobal('fetch',request);
 const worker=await createProductionGoogleCalendarWorker(config);
 expect(productionGoogleCalendarWorkerDatabase(config)).toBeTypeOf('function');
 await expect(worker({businessId:randomUUID(),destinationId:randomUUID(),jobId:randomUUID(),recoveryEpoch:randomUUID(),generation:'1'},new AbortController().signal)).resolves.toEqual({state:'unavailable'});expect(request).not.toHaveBeenCalled();
 const noGrant={...config,productionCapabilities:createProductionCapabilities({productionActivation:'ready'},input.businessId,productionCalendarWorkerBaseCapabilities)};
 await expect(createProductionGoogleCalendarWorker(noGrant)).rejects.toThrow('GOOGLE_CALENDAR_PRODUCTION_WORKER_CONFIGURATION_REQUIRED');expect(()=>productionGoogleCalendarWorkerDatabase(noGrant)).toThrow('GOOGLE_CALENDAR_DATABASE_CONFIGURATION_REQUIRED');
});
it('retains synthetic provider identity protection rather than accepting a live request adapter there',async()=>{
 await expect(createSyntheticGoogleCalendarWorker({environment:'test',origin:'https://127.0.0.1:4319',connectionString:'postgresql://fixture:fixture-only@127.0.0.1/crest_migrate_aaaaaaaaaaaaaaaa',calendarKeyMaterial:randomBytes(32)},{request:fetch})).rejects.toThrow('GOOGLE_CALENDAR_SYNTHETIC_WORKER_CONFIGURATION_REQUIRED');
});
