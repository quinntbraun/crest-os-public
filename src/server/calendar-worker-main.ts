import compatibility from '../../release/compatibility.json' with {type:'json'};
import {productionReleaseAccepted} from '../security/production-capabilities.ts';
import {readProductionCalendarWorkerProfile} from './production-calendar-worker.ts';

let failure='PRODUCTION_CALENDAR_WORKER_FAILED';
const shutdown=new AbortController(),stop=()=>shutdown.abort();
try{
 Object.assign(process.env,{NODE_ENV:'production'});const args=process.argv.slice(2);
 if(args.length!==2||args[0]!=='--production-calendar-worker'||!args[1])throw Error();
 if(!productionReleaseAccepted(compatibility)){failure='PRODUCTION_RELEASE_NOT_ACCEPTED';throw Error();}
 const tick=await (await readProductionCalendarWorkerProfile(args[1])).open();
 process.once('SIGTERM',stop);process.once('SIGINT',stop);
 const result=await tick(AbortSignal.any([shutdown.signal,AbortSignal.timeout(40000)]));
 const states=['idle','busy','published','removed','no_effect','delayed','reconnect','review','uncertain'];
 if(!states.includes(result.state)||shutdown.signal.aborted)throw Error();
 console.info('GOOGLE_CALENDAR_WORKER_'+result.state.toUpperCase());
}catch{console.error(failure);process.exitCode=1;}
finally{process.off('SIGTERM',stop);process.off('SIGINT',stop);}
