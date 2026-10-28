import {LeadScreen} from './leads';
import {customerUuid} from '../../customer/customer-contract';
export const dynamic='force-dynamic';
export const runtime='nodejs';
export default async function LeadsPage({searchParams}:{searchParams:Promise<{lead?:string|string[]}>}){const params=await searchParams;return <main className="customers"><p className="eyebrow">Crest Detailing</p><h1>Leads</h1><LeadScreen initialLeadId={customerUuid(params.lead)?params.lead:null}/></main>;}
