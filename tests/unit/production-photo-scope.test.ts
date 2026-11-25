// Session/database seams isolate scope sealing; no real authentication or save.
import {randomBytes,randomUUID} from 'node:crypto';
import {it,expect,vi} from 'vitest';
vi.mock('server-only',()=>({}));
const boundary=vi.hoisted(()=>({verify:vi.fn(),query:vi.fn()}));
vi.mock('../../src/security/session-lifecycle.ts',()=>({createSessionLifecycle:()=>({verify:boundary.verify})}));
vi.mock('../../src/security/session-database.ts',()=>({sessionDatabase:()=>boundary.query}));
import {createDropoffPhotoDirectory} from '../../src/operations/dropoff-photo-directory';
import {createProductionCapabilities,productionPhotoWorkerBaseCapabilities} from '../../src/security/production-capabilities';

it('retains the original photo/business while verification waits and refuses a later mutable-config business substitution',async()=>{
 const businessId=randomUUID(),photoId=randomUUID(),foreign=randomUUID(),scope={businessId,jobVehicleId:randomUUID(),photoId};
 const config={environment:'production' as const,connectionString:'postgresql://crest_runtime:fixture-only@database.example.com/crest',businessId,productionCapabilities:createProductionCapabilities({productionActivation:'ready'},businessId,[...productionPhotoWorkerBaseCapabilities,'dropoffPhotos'])};
 let enter!:()=>void,release!:()=>void;const started=new Promise<void>(resolve=>{enter=resolve;}),barrier=new Promise<void>(resolve=>{release=resolve;});
 boundary.verify.mockImplementationOnce(async()=>{enter();await barrier;return {sessionId:randomUUID(),actorId:randomUUID(),provider:{issuer:'https://identity.example.com/auth/v1',subject:randomUUID(),sessionId:randomUUID(),expiresAt:Date.now()+60000}};});
 boundary.query.mockResolvedValueOnce(null);
 const directory=createDropoffPhotoDirectory(config,{} as Parameters<typeof createDropoffPhotoDirectory>[1],{} as Parameters<typeof createDropoffPhotoDirectory>[2]);
 const pending=directory.read(randomBytes(32).toString('base64url'),scope,new AbortController().signal);await started;
 scope.businessId=foreign;scope.photoId=randomUUID();config.businessId=foreign;release();await pending;
 const parameters=boundary.query.mock.calls[0]![1] as unknown[];expect(parameters[7]).toBe(businessId);expect(parameters[8]).toBe(photoId);
 await expect(directory.read('not-a-session',scope,new AbortController().signal)).rejects.toThrow('DROPOFF_PHOTO_UNCONFIRMED');expect(boundary.verify).toHaveBeenCalledTimes(1);
});
