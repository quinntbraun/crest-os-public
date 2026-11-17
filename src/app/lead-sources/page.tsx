import {LeadSourceScreen} from './sources';
export const dynamic='force-dynamic';
export const runtime='nodejs';
export default function LeadSourcesPage(){return <main className="customers services-workspace lead-sources-workspace"><header className="lead-source-page-heading"><h1>Lead sources</h1><a href="/leads">Back to Leads</a></header><LeadSourceScreen/></main>;}
