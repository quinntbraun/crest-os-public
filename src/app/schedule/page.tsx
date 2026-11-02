import {ScheduleScreen} from './screen';
import {customerUuid} from '../../customer/customer-contract';
export const dynamic='force-dynamic';
export const runtime='nodejs';
export default async function SchedulePage({searchParams}:{searchParams:Promise<{job?:string|string[]}>}){const input=await searchParams,jobId=typeof input.job==='string'&&customerUuid(input.job)?input.job:undefined;return <main className="customers"><p className="eyebrow">Crest Detailing</p><h1>Schedule</h1><ScheduleScreen {...jobId?{initialJobId:jobId}:{}}/></main>;}
