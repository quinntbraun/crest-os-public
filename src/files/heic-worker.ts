import 'server-only';
import {assertImageSandbox} from './image-sandbox.ts';
let finished=false;
function finish(value:object,code:number){if(finished)return;finished=true;process.stdout.write(JSON.stringify(value)+'\n',()=>process.exit(code));}
const watchdog=setTimeout(()=>{if(finished)process.exit(1);finish({status:'Quarantined',code:'HEIC_WORKER_TIMEOUT'},1);},45000);watchdog.unref();
try{
  // Fixed build-time profile; no request/argument can increase this bound.
  await assertImageSandbox(1024*1024*1024);
  const {validateHeic,HeicValidationError,maximumHeicBytes}=await import('./heic-validation.ts');
  let length=0;const chunks:Buffer[]=[];
  for await(const chunk of process.stdin){length+=chunk.length;if(length>maximumHeicBytes){finish({status:'Quarantined',code:'HEIC_SIZE_INVALID'},1);break;}chunks.push(chunk);}
  if(!finished){try{const r=await validateHeic(Buffer.concat(chunks,length),process.argv[2]??'image/heic');finish({status:'Validated',...r,preview:{...r.preview,bytes:r.preview.bytes.toString('base64')}},0);}
    catch(e){finish({status:'Quarantined',code:e instanceof HeicValidationError?e.code:'HEIC_DECODE_FAILED'},1);}}
}catch{finish({status:'Quarantined',code:'HEIC_SANDBOX_REQUIRED'},1);}
