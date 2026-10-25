import {AddressScreen} from './addresses';
import {customerUuid} from '../../customer/customer-contract';
export const dynamic='force-dynamic';
export const runtime='nodejs';
export default async function AddressesPage({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){
  const params=await searchParams,customerId=typeof params.customer==='string'&&customerUuid(params.customer)?params.customer:null;
  return <main className="customers"><p className="eyebrow">Crest Detailing</p><h1>Customer addresses</h1><AddressScreen customerId={customerId}/></main>;
}
