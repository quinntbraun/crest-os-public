import {checkApplicationHealth} from './health-check.ts';
void checkApplicationHealth({...(process.env.PORT?{PORT:process.env.PORT}:{}),...(process.env.CREST_HEALTH_ORIGIN?{CREST_HEALTH_ORIGIN:process.env.CREST_HEALTH_ORIGIN}:{})}).catch(()=>{process.exitCode=1;});
