import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
const mocks=vi.hoisted(()=>({spawn:vi.fn(),mkdir:vi.fn(),rmdir:vi.fn()}));
vi.mock('server-only',()=>({}));
vi.mock('node:child_process',()=>({spawn:mocks.spawn}));
vi.mock('node:fs/promises',()=>({mkdtemp:mocks.mkdir,rmdir:mocks.rmdir}));
vi.mock('node:os',()=>({platform:()=> 'linux',tmpdir:()=>'/tmp'}));
import {createLocalSandboxValidator} from '../../src/files/local-sandbox-validator.ts';
import {fileHash} from '../../src/files/validation-reply.ts';
import {imageValidationVersion} from '../../src/files/validation-contract.ts';
const imageId='sha256:'+'d'.repeat(64),container='c'.repeat(64),dispatch='11111111-2222-4333-8444-555555555555';
const bytes=Buffer.from('synthetic file'),jpeg=Buffer.from([255,216,1,2,255,217]);
let mode='',label='',body:Buffer,argsHistory:string[][];
const validation=()=>({status:'Validated',validationVersion:imageValidationVersion,source:{sha256:fileHash(bytes),byteSize:bytes.length,detectedType:'image/png',width:10,height:5},
  preview:{bytes:jpeg.toString('base64'),sha256:fileHash(jpeg),byteSize:jpeg.length,contentType:'image/jpeg',width:10,height:5}});
beforeEach(()=>{
  mode='';label='';body=Buffer.alloc(0);argsHistory=[];mocks.mkdir.mockResolvedValue('/tmp/crest-file-dispatch-owned');mocks.rmdir.mockResolvedValue(undefined);
  mocks.spawn.mockImplementation((executable:string,argv:string[],options:{env:Record<string,string>})=>{
    expect(executable).toBe('/usr/bin/docker');expect(argv.slice(0,4)).toEqual(['--host','unix:///var/run/docker.sock','--config','/tmp/crest-file-dispatch-owned']);
    expect(Object.keys(options.env).sort()).toEqual(['LANG','LC_ALL','NODE_ENV','PATH']);
    const args=argv.slice(4);argsHistory.push(args);
    const child=Object.assign(new EventEmitter(),{stdin:new PassThrough(),stdout:new PassThrough(),stderr:new PassThrough(),kill:vi.fn(()=>true)});
    const chunks:Buffer[]=[];child.stdin.on('data',b=>chunks.push(b));
    child.stdin.once('finish',()=>queueMicrotask(()=>{
      const send=(v:unknown,exit=0)=>{child.stdout.end(typeof v==='string'?v:JSON.stringify(v));child.emit('close',exit);};
      if(args[0]==='create'){label=args[args.indexOf('--label')+1]!.split('=')[1]!;send(mode==='create-unknown'?'not-an-id':container);}
      else if(args[0]==='inspect'&&args[2]==='{{json .}}')send({Id:container,Image:imageId,Config:{Labels:{'crest.file.dispatch':mode==='wrong-owner'?'other':label}}});
      else if(args[0]==='inspect')send({Running:false,OOMKilled:mode==='oom',ExitCode:mode==='quarantine'?1:0});
      else if(args[0]==='rm')send(container,mode==='cleanup-failed'?1:0);
      else if(args[0]==='start'){
        body=Buffer.concat(chunks);child.stderr.write('discarded private native diagnostic');
        if(mode==='hold')return;
        if(mode==='overflow'){child.stdout.write(Buffer.alloc(12*1024*1024+1));return;}
        if(mode==='bad-json')return send('private non-JSON text');
        if(mode==='quarantine')return send({status:'Quarantined',code:'IMAGE_DECODE_FAILED'},1);
        const r=validation();if(mode==='wrong-hash')r.source.sha256='f'.repeat(64);send(r);
      }
    }));
    return child;
  });
});
afterEach(()=>{vi.useRealTimers();vi.clearAllMocks();});
const client=()=>createLocalSandboxValidator({imageId});
const run=()=>client().validate(bytes,'image/png',dispatch);
const drain=async()=>{for(let i=0;i<3;i++)await new Promise(resolve=>setImmediate(resolve));};
it('pins the local image, fixed isolation, no pulls/log retention/host mounts, and exact owned cleanup',async()=>{
  expect((await run()).source.sha256).toBe(fileHash(bytes));expect(body).toEqual(bytes);
  const create=argsHistory[0]!;for(const pair of [['--pull','never'],['--network','none'],['--memory','512m'],['--memory-swap','512m'],['--cpus','1'],['--pids-limit','32'],['--user','node'],['--log-driver','none'],['--entrypoint','/usr/local/bin/node']])expect(create[create.indexOf(pair[0]!)+1]).toBe(pair[1]);
  expect(create).toContain('--read-only');expect(create).toContain('no-new-privileges');expect(create).toContain(imageId);expect(create).not.toContain('--volume');
  expect(argsHistory.at(-1)).toEqual(['rm','--force',container]);expect(mocks.rmdir).toHaveBeenCalledOnce();
});
it('seals caller bytes before any asynchronous work',async()=>{const input=Buffer.from(bytes),pending=client().validate(input,'image/png',dispatch);input.fill(0);await pending;expect(body).toEqual(bytes);});
it.each(['wrong-hash','bad-json','overflow','oom','quarantine'])('withholds invalid/failed output and removes the exact owned container: %s',async failure=>{
  mode=failure;await expect(run()).rejects.toMatchObject({code:failure==='oom'?'SANDBOX_EXECUTION_FAILED':failure==='quarantine'?'FILE_QUARANTINED':'SANDBOX_PROTOCOL_INVALID'});
  expect(argsHistory.at(-1)).toEqual(['rm','--force',container]);
});
it('withholds success when cleanup cannot be confirmed',async()=>{mode='cleanup-failed';const c=client();await expect(c.validate(bytes,'image/png',dispatch)).rejects.toMatchObject({code:'SANDBOX_CLEANUP_UNCERTAIN'});
  const calls=mocks.spawn.mock.calls.length;mode='';await expect(c.validate(bytes,'image/png',dispatch)).rejects.toThrow('SANDBOX_UNAVAILABLE');expect(mocks.spawn.mock.calls.length).toBe(calls);});
it.each(['create-unknown','wrong-owner'])('does not start or delete an unverified container: %s',async failure=>{mode=failure;const c=client();await expect(c.validate(bytes,'image/png',dispatch)).rejects.toThrow(/SANDBOX_(CREATE|CLEANUP)_UNCERTAIN/);expect(argsHistory.some(a=>a[0]==='start'||a[0]==='rm')).toBe(false);
  const calls=mocks.spawn.mock.calls.length;mode='';await expect(c.validate(bytes,'image/png',dispatch)).rejects.toThrow('SANDBOX_UNAVAILABLE');expect(mocks.spawn.mock.calls.length).toBe(calls);});
it('bounds stdout waiting and kills/removes its owned container on deadline',async()=>{
  vi.useFakeTimers({toFake:['Date','setTimeout','clearTimeout']});mode='hold';const pending=run();const rejected=expect(pending).rejects.toMatchObject({code:'SANDBOX_TIMEOUT'});await drain();expect(argsHistory.at(-1)?.[0]).toBe('start');await vi.advanceTimersByTimeAsync(48000);await rejected;
  expect(argsHistory.at(-1)).toEqual(['rm','--force',container]);
});
it('cancellation clears the owned container and does not leave the local concurrency latch set',async()=>{
  mode='hold';const c=client(),controller=new AbortController(),pending=c.validate(bytes,'image/png',dispatch,controller.signal);const rejected=expect(pending).rejects.toMatchObject({code:'SANDBOX_ABORTED'});await drain();
  await expect(c.validate(bytes,'image/png',dispatch)).rejects.toThrow('SANDBOX_UNAVAILABLE');controller.abort();await rejected;expect(argsHistory.at(-1)).toEqual(['rm','--force',container]);
  mode='';await c.validate(bytes,'image/png',dispatch);expect(body).toEqual(bytes);
});
it('rejects pre-cancelled, unsupported, oversized, invalid dispatch and tag-based requests before creating anything',async()=>{
  expect(()=>createLocalSandboxValidator({imageId:'crest-os:ci'})).toThrow('SANDBOX_INPUT_INVALID');
  const c=client();for(const [input,type,id] of [[Buffer.alloc(0),'image/png',dispatch],[Buffer.alloc(25*1024*1024+1),'image/png',dispatch],[bytes,'image/svg+xml',dispatch],[bytes,'image/png','invalid']] as const)
    await expect(c.validate(input,type as 'image/png',id)).rejects.toThrow('SANDBOX_INPUT_INVALID');
  await expect(c.validate(bytes,'image/png',dispatch,AbortSignal.abort())).rejects.toThrow('SANDBOX_ABORTED');expect(mocks.spawn).not.toHaveBeenCalled();
});
