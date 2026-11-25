// Complete reviewed noncredential application projection, private operator only.
import {currentBusinessSourceInventory} from '../security/current-business-source-inventory.ts';
import {currentIdentityInventory} from '../security/current-business-identity-source.ts';
import {currentSessionSource} from '../security/current-business-session-source.ts';
import {currentProviderSourceInventory} from '../security/current-provider-source-inventory.ts';
import {operatorSourceInventory138} from './operator-source-inventory138.ts';
const exclusions:Readonly<Record<string,readonly string[]>>=Object.freeze({
 'crest_private.app_sessions':['token_hash','provider_token_ciphertext','key_id'],
 'crest.google_calendar_dispatch_leases':['worker_principal'],
 'crest.google_calendar_dispatch_sends':['request_body'],
 'crest_private.google_calendar_creation_intents':['reviewed_google_owner'],
 'crest_private.google_calendar_credentials':['key_id','envelope'],
 'crest_private.google_calendar_destination_reviews':['calendar_owner'],
 'crest_private.google_calendar_refresh_claims':['worker_principal'],
 'crest_private.google_calendar_account_bindings':['provider_subject'],
 'crest_private.google_calendar_reconnection_stagings':['provider_subject','reviewed_google_owner']
});
export const instanceSourceInventory138=Object.freeze([
 ...[...currentBusinessSourceInventory,...currentIdentityInventory,currentSessionSource,...currentProviderSourceInventory].map(source=>Object.freeze({source:source.source,columns:source.columns,excluded:Object.freeze([...(exclusions[source.source]??[])])})),
 ...operatorSourceInventory138
].sort((a,b)=>a.source<b.source?-1:a.source>b.source?1:0));
