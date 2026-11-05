import {SaveReviewScreen} from './review';
import {originalOperationKinds} from '../../security/original-operation-reference';
import type {OriginalOperationKind} from '../../security/original-operation-reference';
export const dynamic='force-dynamic';
export const runtime='nodejs';
export default async function SaveReviewPage({searchParams}:{searchParams:Promise<{kind?:string|string[]}>}){const raw=(await searchParams).kind,kind=typeof raw==='string'&&originalOperationKinds.includes(raw as OriginalOperationKind)?raw as OriginalOperationKind:'crm.customer.save';return <main className="customers"><p className="eyebrow">Crest Detailing</p><h1>Interrupted save review</h1><SaveReviewScreen initialKind={kind}/></main>;}
