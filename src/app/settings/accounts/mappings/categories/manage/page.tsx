import {FinanceMappingEditor} from '../../manage/screen';
import {expenseCategoryMappingPurpose} from '../../../../../../bookkeeping/finance-mapping-contract';

export const dynamic='force-dynamic';
export const runtime='nodejs';

export default async function ManageExpenseCategoryMappingsPage({searchParams}:{searchParams:Promise<{purpose?:string|string[]}>}){
 const {purpose}=await searchParams;
 return <main className="customers services-workspace">
  <a href="/settings/accounts/mappings/categories">Expense category mappings</a>
  <h1>Manage expense category approvals</h1>
  <FinanceMappingEditor categories initialPurpose={expenseCategoryMappingPurpose(purpose)?purpose:''}/>
 </main>;
}
