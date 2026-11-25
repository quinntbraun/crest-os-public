import {ServiceScreen} from './services';
import {customerUuid} from '../../customer/customer-contract';
import {readDirectoryInclude} from '../../client/directory-navigation';
export const dynamic='force-dynamic';
export const runtime='nodejs';
export default async function ServicesPage({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){
 const params=await searchParams;
 return <main className="customers services-workspace"><h1>Services</h1><ServiceScreen initialServiceId={customerUuid(params.service)?params.service:null}
  initialIncludeAll={readDirectoryInclude('services',params)}/></main>;
}
