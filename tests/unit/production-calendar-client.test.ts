import {randomUUID} from 'node:crypto';
import {afterEach,it,expect,vi} from 'vitest';
vi.mock('../../src/client/authentication',()=>({authentication:{session:async()=>({csrfToken:'A'.repeat(43),expiresAt:Date.now()+60000})}}));
import {beginGoogleCalendarConnection,readCalendarConnectionInfo,beginGoogleCalendarReconnect,readGoogleCalendarReconnect} from '../../src/client/google-calendar-consent';
const origin='https://crest.example.com',epoch=randomUUID(),googleOwner='crest-owner@example.com';
function authorization(){return new URL('https://accounts.google.com/o/oauth2/v2/auth?'+new URLSearchParams({client_id:'crest-owner-client.apps.googleusercontent.com',redirect_uri:origin+'/api/google-calendar/callback',response_type:'code',scope:'https://www.googleapis.com/auth/calendar.app.created openid',access_type:'offline',include_granted_scopes:'false',state:randomUUID()+'.'+'A'.repeat(43),code_challenge:'B'.repeat(43),code_challenge_method:'S256',login_hint:googleOwner,nonce:'C'.repeat(43),prompt:'consent'}));}
const json=(value:unknown)=>new Response(JSON.stringify(value),{headers:{'content-type':'application/json','cache-control':'private, no-store'}});
afterEach(()=>vi.unstubAllGlobals());
it('uses the same strict identity/PKCE handoff for an explicitly selected saved connection',async()=>{
 const url=authorization(),info={state:'ready' as const,destinationId:randomUUID(),generation:'4',googleOwner};
 const request=vi.fn<typeof fetch>(async()=>json({authorizationUrl:url.href}));vi.stubGlobal('fetch',request);vi.stubGlobal('location',{origin});
 expect(await beginGoogleCalendarReconnect(epoch,info,new AbortController().signal)).toBe(url.href);
 expect(request.mock.calls[0]![0]).toBe('/api/business/google-calendar/start-reconnect');expect(JSON.parse(request.mock.calls[0]![1]!.body as string)).toEqual({recoveryEpoch:epoch,destinationId:info.destinationId,generation:'4',googleOwner,confirmed:true});
});
it('does not accept private provider identity fields in browser reconnect information',async()=>{
 const info={schemaVersion:1,state:'ready',destinationId:randomUUID(),generation:'4',googleOwner};
 vi.stubGlobal('fetch',vi.fn(async()=>json({...info,subject:'private-subject'})));await expect(readGoogleCalendarReconnect(epoch,new AbortController().signal)).rejects.toThrow();
 vi.stubGlobal('fetch',vi.fn(async()=>json(info)));expect((await readGoogleCalendarReconnect(epoch,new AbortController().signal)).state).toBe('ready');
});
it('submits explicit reviewed-account intent to the private same-origin endpoint before returning a verified Google URL',async()=>{
 const url=authorization(),request=vi.fn<typeof fetch>(async()=>json({authorizationUrl:url.href}));vi.stubGlobal('fetch',request);vi.stubGlobal('location',{origin});
 await expect(beginGoogleCalendarConnection(epoch,googleOwner,new AbortController().signal)).resolves.toBe(url.href);
 expect(request.mock.calls[0]![0]).toBe('/api/business/google-calendar/start-authorization');const init=request.mock.calls[0]![1] as RequestInit;expect(JSON.parse(init.body as string)).toEqual({recoveryEpoch:epoch,googleOwner,confirmed:true});expect(init.redirect).toBe('error');
});
it.each(['foreign-host','foreign-callback','broad-scope','no-pkce','duplicate-client','no-nonce','no-consent'] as const)('refuses unsafe authorization handoff: %s',change=>{
 const url=authorization();if(change==='foreign-host')url.hostname='elsewhere.example.com';if(change==='foreign-callback')url.searchParams.set('redirect_uri','https://elsewhere.example.com/callback');if(change==='broad-scope')url.searchParams.set('scope','https://www.googleapis.com/auth/calendar');if(change==='no-pkce')url.searchParams.set('code_challenge_method','plain');if(change==='duplicate-client')url.searchParams.append('client_id','other.apps.googleusercontent.com');
 if(change==='no-nonce')url.searchParams.delete('nonce');if(change==='no-consent')url.searchParams.delete('prompt');
 vi.stubGlobal('fetch',vi.fn(async()=>json({authorizationUrl:url.href})));vi.stubGlobal('location',{origin});return expect(beginGoogleCalendarConnection(epoch,googleOwner,new AbortController().signal)).rejects.toThrow('GOOGLE_CALENDAR_CONSENT_CLIENT_FAILED');
});
it('reads only the authenticated production connection-info contract',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>json({schemaVersion:1,mode:'production',googleOwner})));await expect(readCalendarConnectionInfo(epoch,new AbortController().signal)).resolves.toEqual({mode:'production',googleOwner});
 vi.stubGlobal('fetch',vi.fn(async()=>json({schemaVersion:1,mode:'test',googleOwner})));await expect(readCalendarConnectionInfo(epoch,new AbortController().signal)).rejects.toThrow('GOOGLE_CALENDAR_CONSENT_CLIENT_FAILED');
});
