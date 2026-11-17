import {BusinessSettingsScreen} from './settings';
export const dynamic='force-dynamic';
export const runtime='nodejs';
export default function SettingsPage(){return <main className="settings business-settings"><h1>Business settings</h1><BusinessSettingsScreen/></main>;}
