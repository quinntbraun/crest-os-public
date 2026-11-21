import {SourceExportScreen} from './export-files';
import {PostedFinanceExport} from './posted-finance-export';
export const dynamic='force-dynamic';
export const runtime='nodejs';
export default function ExportFilesPage(){
 return <main className="customers export-workspace">
  <h1>Business data exports</h1>
  <p className="export-privacy">Keep downloaded records in a private folder and maintain a separate database backup.</p>
  <dl className="export-purpose" aria-label="Export types">
   <div><dt>Financial reports</dt><dd>Posted-record CSV packages when available below.</dd></div>
   <div><dt>Business record packages</dt><dd>Only the records and files declared in each package’s manifest.</dd></div>
   <div><dt>Recoverable backups</dt><dd>A separate database backup and tested restore. Downloads here do not establish one.</dd></div>
  </dl>
  <div className="export-collections">
   <PostedFinanceExport/>
   <SourceExportScreen/>
  </div>
  <nav aria-label="Export navigation"><a href="/customers">Customers</a><a href="/settings">Business settings</a><a href="/sign-in">Device sign-in and sign-out</a><a href="/">Crest OS home</a></nav>
 </main>;
}
