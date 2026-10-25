import 'server-only';
import {spawn} from 'node:child_process';
import {mkdtemp,rmdir} from 'node:fs/promises';
import {platform,tmpdir} from 'node:os';
import {join} from 'node:path';
import {fail,fileHash,validInput,readValidationReply,SandboxValidationError} from './validation-reply.ts';
import type {FileType} from './validation-contract.ts';

// Trusted local operator/CI composition only. Never give the web process a Docker
// socket or use this adapter to select a production host by implication.
export function createLocalSandboxValidator(config:{imageId:string}){
  if(!/^sha256:[a-f0-9]{64}$/.test(config.imageId))fail('SANDBOX_INPUT_INVALID');
  const imageId=config.imageId;
  let busy=false;
  return Object.freeze({async validate(input:Uint8Array,type:FileType,dispatchId:string,signal?:AbortSignal){
    validInput(input,type);if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(dispatchId))fail('SANDBOX_INPUT_INVALID');if(platform()!=='linux')fail('SANDBOX_UNAVAILABLE');
    if(busy)fail('SANDBOX_UNAVAILABLE');if(signal?.aborted)fail('SANDBOX_ABORTED');
    // Seal before any await. The image ID and all execution options are fixed.
    const bytes=Buffer.from(input),expected={type,byteSize:bytes.length,sha256:fileHash(bytes)};
    busy=true;const nonce=dispatchId,ends=performance.now()+60000;
    let directory:string|undefined,id:string|undefined,owned=false,cleanupFailed=false;
    const environment={PATH:'/usr/bin:/bin',LANG:'C',LC_ALL:'C',NODE_ENV:'production' as const};
    async function command(args:string[],ms:number,limit:number,body?:Buffer,abort?:AbortSignal){
      if(abort?.aborted)fail('SANDBOX_ABORTED');
      return new Promise<{stdout:Buffer;exit:number}>((resolve,reject)=>{
        const child=spawn('/usr/bin/docker',['--host','unix:///var/run/docker.sock','--config',directory!,...args],{env:environment,stdio:['pipe','pipe','pipe']});
        const chunks:Buffer[]=[];let length=0,settled=false;
        const finish=(error?:SandboxValidationError,exit=0)=>{if(settled)return;settled=true;clearTimeout(timer);abort?.removeEventListener('abort',cancel);if(error){child.kill('SIGKILL');reject(error);}else resolve({stdout:Buffer.concat(chunks,length),exit});};
        const cancel=()=>finish(new SandboxValidationError('SANDBOX_ABORTED'));
        const timer=setTimeout(()=>finish(new SandboxValidationError('SANDBOX_TIMEOUT')),Math.max(1,ms));
        abort?.addEventListener('abort',cancel,{once:true});
        child.stdout.on('data',(b:Buffer)=>{length+=b.length;if(length>limit)finish(new SandboxValidationError('SANDBOX_PROTOCOL_INVALID'));else chunks.push(b);});
        // Discard potentially sensitive native/daemon diagnostics, including on failure.
        child.stderr.resume();child.stdin.on('error',()=>{});
        child.once('error',()=>finish(new SandboxValidationError('SANDBOX_EXECUTION_FAILED')));
        child.once('close',code=>finish(undefined,code??-1));
        if(abort?.aborted)cancel();else child.stdin.end(body);
      });
    }
    try{
      directory=await mkdtemp(join(tmpdir(),'crest-file-dispatch-'));if(signal?.aborted)fail('SANDBOX_ABORTED');
      const heic=type==='image/heic',pdf=type==='application/pdf',memory=heic?'1g':'512m';
      let created;try{
        created=await command(['create','--pull','never','--no-healthcheck','--log-driver','none','--entrypoint','/usr/local/bin/node','--interactive','--name',`crest-file-${nonce}`,'--label',`crest.file.dispatch=${nonce}`,
          '--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges',
          '--memory',memory,'--memory-swap',memory,'--cpus','1','--pids-limit','32','--user','node',
          '--tmpfs',`/tmp:rw,noexec,nosuid,nodev,size=${heic?'320m':'64m'}`,imageId,'--max-old-space-size=128',
          `server/${pdf?'pdf':heic?'heic':'image'}-worker.mjs`,...(pdf?['1']:[type])],10000,65536);
      }catch{return fail('SANDBOX_CREATE_UNCERTAIN');}
      if(created.exit!==0)fail('SANDBOX_CREATE_UNCERTAIN');
      const candidate=created.stdout.toString('utf8').trim();if(!/^[a-f0-9]{64}$/.test(candidate))fail('SANDBOX_CREATE_UNCERTAIN');id=candidate;
      const inspected=await command(['inspect','--format','{{json .}}',id],5000,65536);
      let state;try{state=JSON.parse(inspected.stdout.toString('utf8'));}catch{return fail('SANDBOX_CREATE_UNCERTAIN');}
      if(inspected.exit!==0||state.Id!==id||state.Image!==imageId||state.Config?.Labels?.['crest.file.dispatch']!==nonce)fail('SANDBOX_CREATE_UNCERTAIN');
      owned=true;
      // Reserve cleanup time inside the 60-second total. Never start after cancel.
      if(signal?.aborted)fail('SANDBOX_ABORTED');const remaining=ends-performance.now()-10000;if(remaining<1)fail('SANDBOX_TIMEOUT');
      const response=await command(['start','--attach','--interactive',id],Math.min(48000,remaining),12*1024*1024,bytes,signal);
      const inspectedExit=await command(['inspect','--format','{{json .State}}',id],Math.min(2000,Math.max(1,ends-performance.now()-5000)),65536);
      let exit;try{exit=JSON.parse(inspectedExit.stdout.toString('utf8'));}catch{return fail('SANDBOX_PROTOCOL_INVALID');}
      if(inspectedExit.exit!==0||exit.Running!==false||exit.OOMKilled!==false||exit.ExitCode!==response.exit)fail('SANDBOX_EXECUTION_FAILED');
      return readValidationReply(response.stdout,response.exit,expected);
    }catch(error){if(error instanceof SandboxValidationError)throw error;return fail('SANDBOX_EXECUTION_FAILED');}
    finally{
      if(owned&&id){try{const removed=await command(['rm','--force',id],Math.min(10000,Math.max(1,ends-performance.now())),65536);if(removed.exit!==0)cleanupFailed=true;}catch{cleanupFailed=true;}}
      else if(id)cleanupFailed=true;
      if(directory)try{await rmdir(directory);}catch{cleanupFailed=true;}
      busy=false;
      // A successful decode is withheld unless owned-container removal is confirmed.
      if(cleanupFailed)fail('SANDBOX_CLEANUP_UNCERTAIN');
      if(signal?.aborted)fail('SANDBOX_ABORTED');
      if(performance.now()>ends)fail('SANDBOX_TIMEOUT');
    }
  }});
}
