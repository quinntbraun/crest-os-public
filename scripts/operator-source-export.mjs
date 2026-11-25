import {runOperatorSourceCommand} from '../src/tooling/operator-source-command.ts';
const controller=new AbortController(),stop=()=>controller.abort();
process.once('SIGINT',stop);process.once('SIGTERM',stop);
try{const result=await runOperatorSourceCommand(process.argv.slice(2),controller.signal);process.stdout.write(JSON.stringify(result)+'\n');}
catch{process.stderr.write('OPERATOR_SOURCE_EXPORT_REVIEW_REQUIRED\n');process.exitCode=1;}
finally{process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);}
