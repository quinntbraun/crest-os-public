import {FinanceMappingEditor} from './screen';
import {mappingNavigationHref,readMappingNavigation} from '../../../../../client/mapping-navigation';

export const dynamic='force-dynamic';
export const runtime='nodejs';

export default async function ManageFinanceMappingsPage({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){
 const input=await searchParams,navigation=readMappingNavigation(input,false);
 return <main className="customers services-workspace">
  <a className="record-return-link" href={mappingNavigationHref(false,false,input)}>Dated account mappings</a>
  <h1>Manage mapping approvals</h1>
  <FinanceMappingEditor initialPurpose={navigation.purpose}/>
 </main>;
}
