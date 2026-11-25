import {runRecoveryCaptureStatusCommand} from '../src/tooling/recovery-capture-status.ts';
const controller=new AbortController(),stop=()=>controller.abort();process.once('SIGINT',stop);process.once('SIGTERM',stop);
try{const result=await runRecoveryCaptureStatusCommand(process.argv.slice(2),controller.signal);process.stdout.write(JSON.stringify(result)+'\n');process.exitCode=2;}
catch{process.stderr.write('RECOVERY_CAPTURE_STATUS_REVIEW_REQUIRED\n');process.exitCode=1;}
finally{process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);}
