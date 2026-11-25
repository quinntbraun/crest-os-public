import {customerInstant} from '../../customer/customer-contract';
import type {LeadFollowUp} from '../../customer/lead-follow-up-contract';

export type FollowUpFilter='all'|'due'|'upcoming';
export function loadedFollowUpGroups(page:Readonly<{observedAt:string;followUps:readonly LeadFollowUp[]}>|null|undefined){
 if(!page||!customerInstant(page.observedAt)||page.followUps.some(row=>!customerInstant(row.followUpAt)))return null;
 return {all:page.followUps,due:page.followUps.filter(row=>row.followUpAt<=page.observedAt),upcoming:page.followUps.filter(row=>row.followUpAt>page.observedAt)};
}
