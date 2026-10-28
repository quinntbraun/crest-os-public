import {LeadScreen} from './leads';
export const dynamic='force-dynamic';
export const runtime='nodejs';
export default async function LeadsPage({searchParams}:{searchParams:Promise<{lead?:string|string[]}>}){const params=await searchParams;return <main className="customers"><p className="eyebrow">Crest Detailing</p><h1>Leads</h1><LeadScreen initialLeadId={typeof params.lead==='string'?params.lead:null}/></main>;}
