import {FinanceMappingsScreen} from '../screen';
import {FinanceSetupReturn} from '../../setup-return';
import {readMappingNavigation} from '../../../../../client/mapping-navigation';

export const dynamic='force-dynamic';
export const runtime='nodejs';

export default async function ExpenseCategoryMappingsPage({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){
 const navigation=readMappingNavigation(await searchParams,true);
 return <main className="customers services-workspace">
  <FinanceSetupReturn/>
  <h1>Expense category mappings</h1>
  <p className="field-help">Check which reviewed account applies to a category on a date.</p>
  <a href="/settings/accounts/mappings/categories/manage">Manage category approvals</a>
  <FinanceMappingsScreen categories initialPurpose={navigation.purpose} initialDate={navigation.date}/>
 </main>;
}
