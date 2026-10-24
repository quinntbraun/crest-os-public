// Fresh-process restore: receives only the emergency key, encrypted point and
// freshly owned destination. No source DB URL, provider token or original process.
import { restoreDatabase } from './recovery-drill.mjs';

await restoreDatabase(process.argv[2],process.argv[3],process.env.CREST_RECOVERY_DRILL_TARGET);
console.log('Synthetic isolated database restore and verification completed');
