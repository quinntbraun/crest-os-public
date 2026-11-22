import {it,expect,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {withWorkspaceRuntimeMode,workspaceRuntimeMode} from '../../src/server/workspace-runtime-mode';
it('defaults to the test warning outside configured server request scope',()=>{
 expect(workspaceRuntimeMode()).toBe('test');
 expect(withWorkspaceRuntimeMode('production',()=>workspaceRuntimeMode())).toBe('production');
 expect(workspaceRuntimeMode()).toBe('test');
});
it('isolates overlapping asynchronous request modes and restores the outer scope',async()=>{
 let release!:()=>void;
 const gate=new Promise<void>(resolve=>{release=resolve;});
 const production=withWorkspaceRuntimeMode('production',async()=>{await gate;expect(workspaceRuntimeMode()).toBe('production');await Promise.resolve();expect(workspaceRuntimeMode()).toBe('production');});
 await withWorkspaceRuntimeMode('test',async()=>{expect(workspaceRuntimeMode()).toBe('test');release();await production;expect(workspaceRuntimeMode()).toBe('test');});
 expect(workspaceRuntimeMode()).toBe('test');
});
it('does not retain a production mode after failed work or malformed configuration',async()=>{
 await expect(withWorkspaceRuntimeMode('production',async()=>{throw new Error('closed');})).rejects.toThrow('closed');
 expect(workspaceRuntimeMode()).toBe('test');
 expect(()=>withWorkspaceRuntimeMode('ready' as never,()=>{})).toThrow('WORKSPACE_RUNTIME_CONFIGURATION_REQUIRED');
});
