import { SyntheticGoogleCalendarSettings } from './setup';
import { customerUuid } from '../../../customer/customer-contract';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function GoogleCalendarSettingsPage({ searchParams }: { searchParams: Promise<{ job?: string | string[] }> }) {
  const { job } = await searchParams;
  return <main className="settings calendar-settings">
    <nav className="settings-return" aria-label="Calendar navigation">
      <a href="/settings">Back to Settings</a>
      <a href="/schedule">Open Schedule</a>
    </nav>
    <h1>Calendar setup</h1>
    <SyntheticGoogleCalendarSettings jobId={customerUuid(job) ? job : null}/>
  </main>;
}
