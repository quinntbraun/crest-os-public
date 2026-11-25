import {runRecoveryOwnerKitCommand} from '../src/tooling/recovery-owner-kit-command.ts';
const controller=new AbortController(),stop=()=>controller.abort();
process.once('SIGINT',stop);process.once('SIGTERM',stop);
try{
 const result=await runRecoveryOwnerKitCommand(process.argv.slice(2),controller.signal);
 process.stdout.write(JSON.stringify(result)+'\n');
}catch{
 process.stderr.write('RECOVERY_OFFLINE_MATERIAL_REVIEW_REQUIRED\n');process.exitCode=1;
}finally{
 process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);
}
