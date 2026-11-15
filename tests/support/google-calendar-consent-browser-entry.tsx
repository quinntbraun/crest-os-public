import { createRoot } from 'react-dom/client';
import { GoogleCalendarConsentPanel } from '../../src/app/settings/google-calendar-consent';

const root = document.getElementById('calendar-test');
if (!root) throw Error('CALENDAR_TEST_ROOT_REQUIRED');
createRoot(root).render(<GoogleCalendarConsentPanel context={{
  destinationId: 'aabb0000-0101-4000-a900-000000000001',
  credentialId: 'aabb0000-0101-4000-a900-000000000002',
  recoveryEpoch: 'aabb0000-0101-4000-a900-000000000003',
}}/>);
