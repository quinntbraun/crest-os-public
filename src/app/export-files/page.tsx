import {SourceExportScreen} from './export-files';
import {PostedFinanceExport} from './posted-finance-export';
export const dynamic='force-dynamic';
export const runtime='nodejs';
export default function ExportFilesPage(){
 return <main className="customers export-workspace">
  <h1>Business data exports</h1>
  <p className="export-privacy">Keep downloaded records in a private folder and maintain a separate database backup.</p>
  <div className="export-collections">
   <PostedFinanceExport/>
   <SourceExportScreen/>
  </div>
  <nav aria-label="Export navigation"><a href="/customers">Customers</a><a href="/settings">Business settings</a><a href="/sign-in">Device sign-in and sign-out</a><a href="/">Crest OS home</a></nav>
 </main>;
}
