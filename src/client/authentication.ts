// Browser transport only. Credentials/cookies are never persisted by this module.
export type Proof=Readonly<{csrfToken:string;expiresAt:number}>;
export type LoginInput={email:string;password:string;code:string;trusted:boolean};
export class AuthenticationError extends Error{
  readonly kind:'denied'|'unavailable'|'uncertain';
  constructor(kind:AuthenticationError['kind']){super('AUTHENTICATION_FAILED');this.name='AuthenticationError';this.kind=kind;}
}
function exact(value:unknown,fields:string[]):value is Record<string,unknown>{
  return !!value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===fields.length&&fields.every(key=>Object.hasOwn(value,key));
}
function proof(value:unknown):Proof{
  if(!exact(value,['csrfToken','expiresAt'])||typeof value.csrfToken!=='string'||!/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/.test(value.csrfToken)
    ||typeof value.expiresAt!=='number'||!Number.isSafeInteger(value.expiresAt)||value.expiresAt<=Date.now())throw new AuthenticationError('uncertain');
  return Object.freeze({csrfToken:value.csrfToken,expiresAt:value.expiresAt});
}
async function post(path:'bootstrap'|'login'|'session'|'logout',body:LoginInput|Record<string,never>,signal:AbortSignal,csrf?:string):Promise<unknown>{
  try{
    const response=await fetch('/api/auth/'+path,{method:'POST',credentials:'same-origin',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',
      headers:{'content-type':'application/json',...csrf?{'x-crest-csrf':csrf}:{}},body:JSON.stringify(body),signal:AbortSignal.any([signal,AbortSignal.timeout(40000)])});
    if(!response.ok)throw new AuthenticationError(response.status===400?'denied':response.status===503?'unavailable':'uncertain');
    if(!/^application\/json(?:;\s*charset=utf-8)?$/i.test(response.headers.get('content-type')??''))throw new AuthenticationError('uncertain');
    const reader=response.body?.getReader();if(!reader)throw new AuthenticationError('uncertain');
    const chunks:Uint8Array[]=[];let size=0;
    try{for(;;){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>8192)throw new AuthenticationError('uncertain');chunks.push(part.value);}}
    finally{await reader.cancel().catch(()=>undefined);reader.releaseLock();}
    const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
    return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)) as unknown;
  }catch(error){throw error instanceof AuthenticationError?error:new AuthenticationError('uncertain');}
}
export const authentication=Object.freeze({
  async session(signal:AbortSignal):Promise<Proof>{return proof(await post('session',{},signal));},
  async login(input:LoginInput,signal:AbortSignal):Promise<Proof>{
    const pending=proof(await post('bootstrap',{},signal));
    proof(await post('login',input,signal,pending.csrfToken));
    // Confirm the browser accepted its HttpOnly cookie before claiming success.
    return proof(await post('session',{},signal));
  },
  async logout(current:Proof,signal:AbortSignal):Promise<Readonly<{localRevoked:true;providerSignedOut:boolean}>>{
    const value=await post('logout',{},signal,current.csrfToken);
    if(!exact(value,['localRevoked','providerSignedOut'])||value.localRevoked!==true||typeof value.providerSignedOut!=='boolean')throw new AuthenticationError('uncertain');
    return Object.freeze({localRevoked:true,providerSignedOut:value.providerSignedOut});
  }
});
