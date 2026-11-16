import {FinanceMappingsScreen} from './screen';

export const dynamic='force-dynamic';
export const runtime='nodejs';

export default function FinanceMappingsPage(){
 return <main className="customers services-workspace">
  <a href="/settings/accounts">Chart of accounts</a>
  <h1>Dated account mappings</h1>
  <p className="field-help">Check which account applies on a date or review past approvals.</p>
  <a href="/settings/accounts/mappings/manage">Manage approvals</a>
  <FinanceMappingsScreen/>
 </main>;
}
