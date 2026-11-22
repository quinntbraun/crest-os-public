import {FinanceMappingsScreen} from './screen';
import {FinanceSetupReturn} from '../setup-return';
import {readMappingNavigation} from '../../../../client/mapping-navigation';

export const dynamic='force-dynamic';
export const runtime='nodejs';

export default async function FinanceMappingsPage({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){
 const navigation=readMappingNavigation(await searchParams,false);
 return <main className="customers services-workspace">
  <FinanceSetupReturn/>
  <h1>Dated account mappings</h1>
  <p className="field-help">Check which account applies on a date or review past approvals.</p>
  <a href="/settings/accounts/mappings/manage">Manage approvals</a>
  <FinanceMappingsScreen initialPurpose={navigation.purpose} initialDate={navigation.date}/>
 </main>;
}
