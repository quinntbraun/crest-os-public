import {FinanceTaxProfilesScreen} from './screen';

export const dynamic='force-dynamic';
export const runtime='nodejs';

export default function FinanceTaxProfilesPage(){
 return <main className="customers services-workspace">
  <a href="/settings/accounts">Chart of accounts</a>
  <h1>Tax profiles</h1>
  <p className="field-help">Review fictional tax treatment and check how it applies to an amount on a chosen date.</p>
  <FinanceTaxProfilesScreen/>
 </main>;
}
