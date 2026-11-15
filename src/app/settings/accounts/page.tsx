import {FinanceAccountsScreen} from './screen';

export const dynamic='force-dynamic';
export const runtime='nodejs';

export default function FinanceAccountsPage(){
 return <main className="customers services-workspace">
  <a href="/settings">Business settings</a>
  <h1>Accounting</h1>
  <p className="field-help">Review posted balances, customer funds, and outstanding invoices.</p>
  <FinanceAccountsScreen/>
 </main>;
}
