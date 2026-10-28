import {SourceExportScreen} from './export-files';
export const dynamic='force-dynamic';
export const runtime='nodejs';
export default function ExportFilesPage(){return <main className="customers"><p className="eyebrow">Crest Detailing</p><h1>Business data exports</h1><SourceExportScreen/><nav aria-label="Export navigation"><a href="/customers">Customers</a><a href="/settings">Business settings</a><a href="/sign-in">Device sign-in and sign-out</a><a href="/">Crest OS home</a></nav></main>;}
