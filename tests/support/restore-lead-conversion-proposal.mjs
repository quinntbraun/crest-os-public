// Fresh synthetic process: destination and independent emergency key only.
// Expected proposal identity is rebuilt from trusted checkout sources.
import {restoreDatabase} from './recovery-drill.mjs';
try{
 if(process.argv.length!==4||!process.env.CREST_RECOVERY_DRILL_TARGET)throw new Error();
 await restoreDatabase(process.argv[2],process.argv[3],process.env.CREST_RECOVERY_DRILL_TARGET,undefined,'lead_conversion_proposal');
 process.stdout.write('Synthetic isolated conversion restore and verification completed\n');
}catch(error){
 const stage=error instanceof Error?error.message.match(/^SYNTHETIC_RECOVERY_RESTORE_FAILED:([a-z_]+)$/)?.[1]:undefined;
 process.stderr.write('SYNTHETIC_RECOVERY_RESTORE_FAILED'+(stage?':'+stage:'')+'\n');process.exitCode=1;
}
