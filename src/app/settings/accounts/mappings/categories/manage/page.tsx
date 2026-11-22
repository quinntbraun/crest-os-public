import {FinanceMappingEditor} from '../../manage/screen';
import {mappingNavigationHref,readMappingNavigation} from '../../../../../../client/mapping-navigation';

export const dynamic='force-dynamic';
export const runtime='nodejs';

export default async function ManageExpenseCategoryMappingsPage({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){
 const input=await searchParams,navigation=readMappingNavigation(input,true);
 return <main className="customers services-workspace">
  <a className="record-return-link" href={mappingNavigationHref(true,false,input)}>Expense category mappings</a>
  <h1>Manage expense category approvals</h1>
  <FinanceMappingEditor categories initialPurpose={navigation.purpose}/>
 </main>;
}
