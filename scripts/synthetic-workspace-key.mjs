import {importJWK} from 'jose';

// GoTrue's persisted signing/verification JWK metadata is not a valid WebCrypto
// private-key usage list. Import the private material for signing only, without
// mutating the provider's stored configuration or implementing crypto ourselves.
export async function importSyntheticSigningKey(jwk){
 try{
  if(!jwk||jwk.kty!=='EC'||jwk.crv!=='P-256'||jwk.alg!=='ES256'||jwk.use!=='sig'||typeof jwk.d!=='string'||!Array.isArray(jwk.key_ops)||!jwk.key_ops.includes('sign')||jwk.key_ops.some(value=>!['sign','verify'].includes(value)))throw Error();
  return await importJWK({...jwk,key_ops:['sign']},'ES256');
 }catch{throw Error('SYNTHETIC_SIGNING_KEY_REQUIRED');}
}
