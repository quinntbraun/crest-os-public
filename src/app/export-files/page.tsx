import Link from 'next/link';
import {SourceExportScreen} from './export-files';
export const dynamic='force-dynamic';
export const runtime='nodejs';
export default function ExportFilesPage(){return <main className="customers"><p className="eyebrow">Crest Detailing</p><h1>Business data exports</h1><SourceExportScreen/><nav aria-label="Export navigation"><Link href="/customers">Customers</Link><Link href="/settings">Business settings</Link><Link href="/sign-in">Device sign-in and sign-out</Link><Link href="/">Crest OS home</Link></nav></main>;}
