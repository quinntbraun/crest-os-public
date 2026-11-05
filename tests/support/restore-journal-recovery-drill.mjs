// Fresh process receives only encrypted point, independent key and destination.
import {restoreJournalDatabase} from './journal-recovery-drill.mjs';
await restoreJournalDatabase(process.argv[2],process.argv[3],process.env.CREST_RECOVERY_DRILL_TARGET);
console.log('Synthetic proposed journal isolated restore and verification completed');
