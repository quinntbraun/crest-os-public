import {JobChangeScreen} from './change';
import {customerUuid} from '../../../customer/customer-contract';
export const dynamic='force-dynamic';
export const runtime='nodejs';
export default async function ChangeJobPage({searchParams}:{searchParams:Promise<{job?:string|string[];kind?:string|string[]}>}){const query=await searchParams,jobId=typeof query.job==='string'&&customerUuid(query.job)?query.job:'',kind=query.kind==='cancel'?'cancel':'reschedule';return <main className="customers"><p className="eyebrow">Crest Detailing</p><h1>{kind==='cancel'?'Cancel scheduled job':'Change appointment'}</h1><JobChangeScreen jobId={jobId} kind={kind}/></main>;}
