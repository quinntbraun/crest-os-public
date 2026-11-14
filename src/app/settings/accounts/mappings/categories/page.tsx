import {FinanceMappingsScreen} from '../screen';

export const dynamic='force-dynamic';
export const runtime='nodejs';

export default function ExpenseCategoryMappingsPage(){
 return <main className="customers services-workspace">
  <a href="/settings/accounts">Chart of accounts</a>
  <h1>Expense category mappings</h1>
  <p className="field-help">Check which reviewed account applies to a category on a date.</p>
  <a href="/settings/accounts/mappings/categories/manage">Manage category approvals</a>
  <FinanceMappingsScreen categories/>
 </main>;
}
