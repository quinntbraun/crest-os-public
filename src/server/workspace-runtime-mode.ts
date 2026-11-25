import 'server-only';
import {AsyncLocalStorage} from 'node:async_hooks';

export type WorkspaceRuntimeMode='test'|'production';
// The custom server and Next compile separate module graphs in the same Node
// process. Share the request-local store, not a global mutable current mode.
const key=Symbol.for('crest.workspace-runtime-mode.v1');
const globals=globalThis as typeof globalThis&{[key:symbol]:unknown};
const existing=globals[key];
if(existing!==undefined&&!(existing instanceof AsyncLocalStorage))throw new Error('WORKSPACE_RUNTIME_CONFIGURATION_REQUIRED');
const context=(existing??new AsyncLocalStorage<WorkspaceRuntimeMode>()) as AsyncLocalStorage<WorkspaceRuntimeMode>;
globals[key]=context;

export function withWorkspaceRuntimeMode<T>(mode:WorkspaceRuntimeMode,work:()=>T):T{
 if(mode!=='test'&&mode!=='production')throw new Error('WORKSPACE_RUNTIME_CONFIGURATION_REQUIRED');
 return context.run(mode,work);
}
export function workspaceRuntimeMode():WorkspaceRuntimeMode{return context.getStore()??'test';}
