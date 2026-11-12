import {FinanceMappingEditor} from './screen';

export const dynamic='force-dynamic';
export const runtime='nodejs';

export default function ManageFinanceMappingsPage(){
 return <main className="customers services-workspace">
  <a href="/settings/accounts/mappings">Dated account mappings</a>
  <h1>Manage mapping approvals</h1>
  <FinanceMappingEditor/>
 </main>;
}
