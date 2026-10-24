import 'server-only';
import {readFile} from 'node:fs/promises';
import {networkInterfaces} from 'node:os';

// Admission check, not a sandbox constructor. The orchestrator must apply the
// actual container controls. Missing/unrecognised cgroup-v2 profiles fail closed.
export async function assertImageSandbox(memoryLimit=512*1024*1024){
  if(process.platform!=='linux'||!process.getuid||process.getuid()===0)throw new Error('IMAGE_SANDBOX_REQUIRED');
  const [status,mounts,memory,swap,pids,cpu]=await Promise.all([
    readFile('/proc/self/status','utf8'),readFile('/proc/self/mountinfo','utf8'),
    readFile('/sys/fs/cgroup/memory.max','utf8'),readFile('/sys/fs/cgroup/memory.swap.max','utf8'),
    readFile('/sys/fs/cgroup/pids.max','utf8'),readFile('/sys/fs/cgroup/cpu.max','utf8')
  ]);
  const root=mounts.split('\n').map(line=>line.split(' ')).find(fields=>fields[4]==='/');
  const [quota,period]=cpu.trim().split(/\s+/).map(Number);
  const positiveBound=(value:string,max:number)=>/^\d+$/.test(value.trim())&&Number(value)>0&&Number(value)<=max;
  if(!/^NoNewPrivs:\s+1$/m.test(status)||!/^CapEff:\s+0+$/m.test(status)||!/^CapBnd:\s+0+$/m.test(status)||!/^Seccomp:\s+2$/m.test(status)
    ||!root?.[5]?.split(',').includes('ro')||!positiveBound(memory,memoryLimit)||swap.trim()!=='0'
    ||!positiveBound(pids,32)||!quota||!period||quota>period
    ||Object.values(networkInterfaces()).flat().some(address=>address&&!address.internal))throw new Error('IMAGE_SANDBOX_REQUIRED');
}
