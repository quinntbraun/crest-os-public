import {FieldSessionScreen} from './work';
import {customerUuid} from '../../../customer/customer-contract';
export const dynamic='force-dynamic';
export const runtime='nodejs';
export default async function FieldWorkPage({searchParams}:{searchParams:Promise<{job?:string|string[]}>}){const query=await searchParams,jobId=typeof query.job==='string'&&customerUuid(query.job)?query.job:'';return <main className="customers"><p className="eyebrow">Crest Detailing · Mobile work</p><h1>Work status</h1><FieldSessionScreen jobId={jobId}/></main>;}
