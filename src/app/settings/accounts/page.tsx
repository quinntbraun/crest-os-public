import {FinanceAccountsScreen} from './screen';

export const dynamic='force-dynamic';
export const runtime='nodejs';

export default function FinanceAccountsPage(){
 return <main className="customers services-workspace">
  <a href="/settings">Business settings</a>
  <h1>Chart of accounts</h1>
  <p className="field-help">Review the chart of accounts and fictional finance setup.</p>
  <FinanceAccountsScreen/>
 </main>;
}
