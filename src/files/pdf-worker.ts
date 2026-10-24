import 'server-only';
import {assertImageSandbox} from './image-sandbox.ts';
let finished=false;
function finish(value:object,code:number){
  if(finished)return;finished=true;process.exitCode=code;process.stdout.write(JSON.stringify(value)+'\n',()=>process.exit(code));
}
const watchdog=setTimeout(()=>finish({status:'Quarantined',code:'PDF_WORKER_TIMEOUT'},1),30000);watchdog.unref();
try{
  await assertImageSandbox();
  const {validatePdf,PdfValidationError,maximumPdfBytes}=await import('./pdf-validation.ts');
  let length=0;const chunks:Buffer[]=[];
  for await(const chunk of process.stdin){length+=chunk.length;if(length>maximumPdfBytes){finish({status:'Quarantined',code:'PDF_SIZE_INVALID'},1);break;}chunks.push(chunk);}
  if(!finished){
    try{
      const result=await validatePdf(Buffer.concat(chunks,length),process.argv[2]===undefined?1:Number(process.argv[2]));
      finish({status:'Validated',...result,preview:{...result.preview,bytes:result.preview!.bytes.toString('base64')}},0);
    }catch(error){finish({status:'Quarantined',code:error instanceof PdfValidationError?error.code:'PDF_RENDER_FAILED'},1);}
  }
}catch{finish({status:'Quarantined',code:'PDF_SANDBOX_REQUIRED'},1);}
