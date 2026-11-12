import {FinanceMappingEditor} from '../../manage/screen';

export const dynamic='force-dynamic';
export const runtime='nodejs';

export default function ManageExpenseCategoryMappingsPage(){
 return <main className="customers services-workspace">
  <a href="/settings/accounts/mappings/categories">Expense category mappings</a>
  <h1>Manage expense category approvals</h1>
  <FinanceMappingEditor categories/>
 </main>;
}
