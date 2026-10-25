// Fresh-process restore: receives only the emergency key, encrypted point and
// freshly owned destination. No source DB URL, provider token or original process.
import { restoreDatabase } from './lead-recovery-proposal.mjs';
import {restoreObjectArchive} from '../../src/tooling/object-recovery.ts';
import {objectDirectory,decryptor} from './object-recovery-drill.mjs';

const vault=await objectDirectory(process.env.CREST_RECOVERY_DRILL_VAULT),destination=await objectDirectory(process.env.CREST_RECOVERY_DRILL_OBJECTS);
await restoreDatabase(process.argv[2],process.argv[3],process.env.CREST_RECOVERY_DRILL_TARGET,a=>restoreObjectArchive(a.receipt,a.inventory,{readVault:vault.read,unseal:decryptor(process.argv[3]),putDestination:destination.put,readDestination:destination.read}));
console.log('Synthetic isolated database restore and verification completed');
