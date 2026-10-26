import {parseLeadAddressDraft} from './lead-resource-contract.ts';
import type {LeadAddressDraft} from './lead-resource-contract.ts';

// Fixed flat primitives only. Business and genuine parent authority are
// selected/rechecked at the private server boundary, never inferred here.
export const leadAddressWireDraftKeys=['line1','line2','city','region','postalCode','country','exactLocationText','instructions','latitude','longitude','geocodeSource','geocodeAccuracy','verifiedAt','archived','archiveReason'] as const;
export function parseLeadAddressWireDraft(value:unknown):LeadAddressDraft{
 return parseLeadAddressDraft(value);
}
export function leadAddressDraftToWire(value:LeadAddressDraft){
 return parseLeadAddressDraft(value);
}
