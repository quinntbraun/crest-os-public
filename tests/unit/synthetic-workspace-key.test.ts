import {describe,it,expect} from 'vitest';
import {exportJWK,generateKeyPair,jwtVerify,SignJWT} from 'jose';
import {importSyntheticSigningKey} from '../../scripts/synthetic-workspace-key.mjs';

describe('persisted synthetic provider signing key',()=>{
 it('survives JSON persistence and signs a verifiable token without mutating provider usages',async()=>{
  const {privateKey,publicKey}=await generateKeyPair('ES256',{extractable:true});
  const original=JSON.parse(JSON.stringify({...await exportJWK(privateKey),kid:'synthetic-test',alg:'ES256',use:'sig',key_ops:['sign','verify']}));
  Object.freeze(original.key_ops);Object.freeze(original);
  const key=await importSyntheticSigningKey(original),token=await new SignJWT({purpose:'synthetic-fixture'}).setProtectedHeader({alg:'ES256',kid:original.kid}).setIssuedAt().setExpirationTime('1m').sign(key);
  expect((await jwtVerify(token,publicKey,{algorithms:['ES256']})).payload.purpose).toBe('synthetic-fixture');expect(original.key_ops).toEqual(['sign','verify']);
 });
 it('rejects missing private material and unsuitable usages with a redacted error',async()=>{
  const {privateKey}=await generateKeyPair('ES256',{extractable:true}),jwk={...await exportJWK(privateKey),alg:'ES256',use:'sig',key_ops:['sign','verify']};
  for(const patch of [{d:undefined},{key_ops:['verify']},{key_ops:['sign','encrypt']},{alg:'ES384'},{d:'invalid-private-material'}])await expect(importSyntheticSigningKey({...jwk,...patch})).rejects.toThrow(/^SYNTHETIC_SIGNING_KEY_REQUIRED$/);
 });
});
