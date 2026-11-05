// Fresh process receives only encrypted point, independent key and destination.
import {restoreRegisteredJournalDatabase} from './journal-recovery-drill.mjs';
await restoreRegisteredJournalDatabase(process.argv[2],process.argv[3],process.env.CREST_RECOVERY_DRILL_TARGET);
console.log('Synthetic registered43 journal isolated restore and verification completed');
