import 'server-only';
import {assertImageSandbox} from './image-sandbox.ts';

let finished=false;
function finish(value:object,code:number){
  if(finished)return;finished=true;process.exitCode=code;
  process.stdout.write(JSON.stringify(value)+'\n',()=>process.exit(code));
}
const watchdog=setTimeout(()=>finish({status:'Quarantined',code:'IMAGE_WORKER_TIMEOUT'},1),15000);
watchdog.unref();
try{
  await assertImageSandbox();
  // Do not even load the native decoder until the process passes admission.
  const {validateImage,ImageValidationError,maximumImageBytes}=await import('./image-validation.ts');
  let length=0;const chunks:Buffer[]=[];
  for await(const chunk of process.stdin){
    length+=chunk.length;
    if(length>maximumImageBytes){finish({status:'Quarantined',code:'IMAGE_SIZE_INVALID'},1);break;}
    chunks.push(chunk);
  }
  if(!finished){
    try{
      const result=await validateImage(Buffer.concat(chunks,length),process.argv[2]??'');
      finish({status:'Validated',...result,preview:{...result.preview,bytes:result.preview.bytes.toString('base64')}},0);
    }catch(error){finish({status:'Quarantined',code:error instanceof ImageValidationError?error.code:'IMAGE_DECODE_FAILED'},1);}
  }
}catch{finish({status:'Quarantined',code:'IMAGE_SANDBOX_REQUIRED'},1);}
