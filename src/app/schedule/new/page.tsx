import {BookJobScreen} from './booking';
import {customerUuid} from '../../../customer/customer-contract';
export const dynamic='force-dynamic';
export const runtime='nodejs';
export default async function BookJobPage({searchParams}:{searchParams:Promise<{agreement?:string|string[]}>}){const input=await searchParams,familyId=typeof input.agreement==='string'&&customerUuid(input.agreement)?input.agreement:'';return <main className="customers"><p className="eyebrow">Crest Detailing</p><h1>Book a visit</h1><BookJobScreen familyId={familyId}/></main>;}
