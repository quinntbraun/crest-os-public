import {MoneyChannelsScreen} from './screen';

export const dynamic='force-dynamic';
export const runtime='nodejs';

export default function MoneyChannelsPage(){
 return <main className="customers services-workspace">
  <a href="/settings/accounts">Chart of accounts</a>
  <h1>Money channels</h1>
  <p className="field-help">Record where Crest’s money is held and review opening evidence. Posting is unavailable in this fictional workspace.</p>
  <MoneyChannelsScreen/>
 </main>;
}
