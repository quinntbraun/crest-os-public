import {QuoteScreen} from './quotes';
import {customerUuid} from '../../customer/customer-contract';
export const dynamic='force-dynamic';
export const runtime='nodejs';
export default async function QuotesPage({searchParams}:{searchParams:Promise<{customer?:string|string[]}>}){
 const {customer}=await searchParams;
 return <main className="customers services-workspace"><h1>Quotes</h1><QuoteScreen initialCustomerId={customerUuid(customer)?customer:null}/></main>;
}
