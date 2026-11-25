import {LeadScreen} from './leads';
import {customerUuid} from '../../customer/customer-contract';
import {readDirectoryInclude,readLeadNavigation} from '../../client/directory-navigation';
export const dynamic='force-dynamic';
export const runtime='nodejs';
export default async function LeadsPage({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){
 const params=await searchParams,{lead}=params,navigation=readLeadNavigation(params);
 return <main className="customers"><p className="eyebrow">Crest Detailing</p><h1>Leads</h1><LeadScreen initialLeadId={customerUuid(lead)?lead:null} initialIncludeAll={readDirectoryInclude('leads',params)}
  initialDirectory={navigation.directory} initialFollowUpFilter={navigation.reminders}/></main>;}
