import { randomBytes,randomUUID } from 'node:crypto';
import { FlattenedEncrypt,flattenedDecrypt } from 'jose';
import { describe,it,expect,vi } from 'vitest';
vi.mock('server-only',()=>({}));
import { createProviderTokenStore,ProviderTokenStorageError } from '../../src/security/provider-token-store.ts';
import type { TokenBinding,EncryptedProviderTokens } from '../../src/security/provider-token-store.ts';

const tokens={accessToken:'synthetic.access.token',refreshToken:'synthetic-refresh-token'};
const binding:TokenBinding={actorId:randomUUID(),appSessionId:randomUUID(),providerSessionId:randomUUID(),securityEpoch:randomUUID(),subject:randomUUID(),issuer:'https://synthetic.example.com/auth/v1'};
const encoder=new TextEncoder();
const aad=()=>encoder.encode(JSON.stringify(['crest.provider-tokens.v1',binding.actorId,binding.appSessionId,binding.providerSessionId,binding.securityEpoch,binding.subject,binding.issuer]));
async function fixture(){const key=randomBytes(32);return {key,store:await createProviderTokenStore('key1',[{id:'key1',key}])};}
const denied=async(work:Promise<unknown>)=>{
  const error=await work.then(()=>null,(error:unknown)=>error);
  expect(error).toBeInstanceOf(ProviderTokenStorageError);
  expect((error as Error).message).toBe('PROVIDER_TOKEN_STORAGE_FAILED');expect((error as Error).cause).toBeUndefined();
};
const rewrite=(r:EncryptedProviderTokens,change:(j:Record<string,unknown>)=>void)=>{const j=JSON.parse(Buffer.from(r.ciphertext).toString());change(j);return {...r,ciphertext:encoder.encode(JSON.stringify(j))};};

describe('standard JWE provider token storage',()=>{
  it('round trips with JOSE interoperability, random IVs, and no accidental plaintext serialization',async()=>{
    const {key,store}=await fixture(),a=await store.encrypt(tokens,binding),b=await store.encrypt(tokens,binding);
    expect(a.ciphertext).not.toEqual(b.ciphertext);
    const jwe=JSON.parse(Buffer.from(a.ciphertext).toString()),independent=await flattenedDecrypt(jwe,key,{keyManagementAlgorithms:['dir'],contentEncryptionAlgorithms:['A256GCM']});
    expect(JSON.parse(new TextDecoder().decode(independent.plaintext))).toEqual(tokens);
    expect(independent.additionalAuthenticatedData).toEqual(aad());
    expect(independent.protectedHeader).toEqual({alg:'dir',enc:'A256GCM',kid:'key1',typ:'application/vnd.crest.provider-tokens.v1+json'});
    const material=await store.decrypt(a,binding);expect(material.tokensForProvider()).toEqual(tokens);
    expect(Object.keys(material)).toEqual([]);expect(()=>JSON.stringify(material)).toThrow(ProviderTokenStorageError);
    expect(Buffer.from(a.ciphertext).toString()).not.toContain(tokens.accessToken);
    expect(Buffer.from(a.ciphertext).toString()).not.toContain(tokens.refreshToken);
  });
  it('accepts an independently generated JWE with the documented profile',async()=>{
    const {key,store}=await fixture();const jwe=await new FlattenedEncrypt(encoder.encode(JSON.stringify(tokens)))
      .setProtectedHeader({alg:'dir',enc:'A256GCM',kid:'key1',typ:'application/vnd.crest.provider-tokens.v1+json'}).setAdditionalAuthenticatedData(aad()).encrypt(key);
    expect((await store.decrypt({keyId:'key1',ciphertext:encoder.encode(JSON.stringify(jwe))},binding)).tokensForProvider()).toEqual(tokens);
  });
  for(const field of ['actorId','appSessionId','providerSessionId','securityEpoch','subject','issuer'] as const){
    it(`rejects a different ${field}`,async()=>{const {store}=await fixture(),r=await store.encrypt(tokens,binding);await denied(store.decrypt(r,{...binding,[field]:field==='issuer'?'https://other.example.com/auth/v1':randomUUID()}));});
  }
  for(const field of ['protected','aad','iv','ciphertext','tag']){
    it(`rejects altered ${field}`,async()=>{const {store}=await fixture(),r=await store.encrypt(tokens,binding);await denied(store.decrypt(rewrite(r,j=>{const value=j[field] as string;j[field]=(value[0]==='A'?'B':'A')+value.slice(1);}),binding));});
  }
  it('retains old decryption keys while using the active key for rotation; removed/wrong keys deny',async()=>{
    const {key,store}=await fixture(),r=await store.encrypt(tokens,binding),next=randomBytes(32);
    const rotated=await createProviderTokenStore('key2',[{id:'key1',key},{id:'key2',key:next}]);
    const material=await rotated.decrypt(r,binding),updated=await rotated.encrypt(material.tokensForProvider(),binding);
    expect(updated.keyId).toBe('key2');expect((await rotated.decrypt(updated,binding)).tokensForProvider()).toEqual(tokens);
    const removed=await createProviderTokenStore('key2',[{id:'key2',key:next}]);await denied(removed.decrypt(r,binding));
    const wrong=await createProviderTokenStore('key1',[{id:'key1',key:randomBytes(32)}]);await denied(wrong.decrypt(r,binding));
    await denied(rotated.decrypt({...r,keyId:'key2'},binding));await denied(store.decrypt(updated,binding));
  });
  it('rejects forged bindings and key labels even when metadata and trusted expectations agree',async()=>{
    const {key,store}=await fixture(),r=await store.encrypt(tokens,binding),other={...binding,appSessionId:randomUUID()};
    const forged=rewrite(r,j=>{j.aad=Buffer.from(JSON.stringify(['crest.provider-tokens.v1',other.actorId,other.appSessionId,other.providerSessionId,other.securityEpoch,other.subject,other.issuer])).toString('base64url');});
    // This passes expected-AAD comparison and must fail GCM authentication.
    await denied(store.decrypt(forged,other));
    const aliases=await createProviderTokenStore('key2',[{id:'key1',key},{id:'key2',key}]);
    const relabeled=rewrite(r,j=>{const h=JSON.parse(Buffer.from(j.protected as string,'base64url').toString());j.protected=Buffer.from(JSON.stringify({...h,kid:'key2'})).toString('base64url');});
    await denied(aliases.decrypt({...relabeled,keyId:'key2'},binding));
  });
  it('copies key configuration before yielding and never exposes imported keys',async()=>{
    const key=randomBytes(32),entry={id:'key1',key},pending=createProviderTokenStore('key1',[entry]);key.fill(0);entry.id='changed';
    const store=await pending,r=await store.encrypt(tokens,binding);expect(r.keyId).toBe('key1');expect((await store.decrypt(r,binding)).tokensForProvider()).toEqual(tokens);
    const zero=await createProviderTokenStore('key1',[{id:'key1',key}]);await denied(zero.decrypt(r,binding));expect(Object.keys(store).sort()).toEqual(['decrypt','encrypt']);
  });
  for(const extra of ['unprotected','header','recipients','encrypted_key','jku','zip']){
    it(`rejects extra ${extra} envelope fields`,async()=>{const {store}=await fixture(),r=await store.encrypt(tokens,binding);await denied(store.decrypt(rewrite(r,j=>{j[extra]={};}),binding));});
  }
  for(const change of [{alg:'A256KW'},{enc:'A128GCM'},{kid:'other'},{typ:'other'},{zip:'DEF'},{jku:'https://keys.example.com'},{crit:['unknown']}]){
    it(`rejects protected header changes ${Object.keys(change).join()}`,async()=>{
      const {store}=await fixture(),r=await store.encrypt(tokens,binding);
      await denied(store.decrypt(rewrite(r,j=>{const header=JSON.parse(Buffer.from(j.protected as string,'base64url').toString());j.protected=Buffer.from(JSON.stringify({...header,...change})).toString('base64url');}),binding));
    });
  }
  for(const value of ['', '{', 'null', '[]', '{"x":1,"x":2}', ' '.repeat(65537)]){
    it(`rejects malformed or oversized envelope (${value.length} bytes)`,async()=>{const {store}=await fixture();await denied(store.decrypt({keyId:'key1',ciphertext:encoder.encode(value)},binding));});
  }
  it('rejects duplicate header names, noncanonical base64url and malformed authenticated plaintext',async()=>{
    const {key,store}=await fixture(),r=await store.encrypt(tokens,binding);
    await denied(store.decrypt(rewrite(r,j=>{j.tag=String(j.tag)+'=';}),binding));
    await denied(store.decrypt(rewrite(r,j=>{j.protected=Buffer.from('{"alg":"dir","alg":"dir","enc":"A256GCM","kid":"key1","typ":"application/vnd.crest.provider-tokens.v1+json"}').toString('base64url');}),binding));
    for(const plain of ['null','{"accessToken":"one","refreshToken":"two","extra":true}','{"accessToken":"one","accessToken":"two","refreshToken":"three"}','{"accessToken":"","refreshToken":"two"}']){
      const jwe=await new FlattenedEncrypt(encoder.encode(plain)).setProtectedHeader({alg:'dir',enc:'A256GCM',kid:'key1',typ:'application/vnd.crest.provider-tokens.v1+json'}).setAdditionalAuthenticatedData(aad()).encrypt(key);
      await denied(store.decrypt({keyId:'key1',ciphertext:encoder.encode(JSON.stringify(jwe))},binding));
    }
  });
  it('rejects invalid bindings, token lengths, and records exceeding the existing database bound',async()=>{
    const {store}=await fixture();for(const issuer of ['https://synthetic.example.com/auth/v1/','http://remote.example.com/auth/v1','https://u:p@example.com/auth/v1','https://synthetic.example.com/auth/v1?x=1'])await denied(store.encrypt(tokens,{...binding,issuer}));
    await denied(store.encrypt(tokens,{...binding,actorId:'invalid'}));
    for(const accessToken of ['', 'x'.repeat(16385), 'token\nsecret'])await denied(store.encrypt({...tokens,accessToken},binding));
    await denied(store.encrypt({accessToken:'x'.repeat(16384),refreshToken:'x'.repeat(32768)},binding));
  });
  it('rejects missing, duplicate, excessive, incorrectly sized or invalid key configuration',async()=>{
    const key=randomBytes(32);for(const entries of [[],[{id:'key2',key}],[{id:'key1',key:new Uint8Array(31)}],[{id:'key1',key},{id:'key1',key}],[{id:'bad id',key}],Array.from({length:17},(_,n)=>({id:`key${n}`,key}))])await denied(createProviderTokenStore('key1',entries));
    await denied(createProviderTokenStore('bad id',[{id:'key1',key}]));
  });
});
