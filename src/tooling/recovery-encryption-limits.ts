// Standard age v1 payload: 64KiB plaintext chunks plus a 16-byte AEAD tag
// per chunk. Retain the existing 64KiB header/nonce allowance and hard 1GiB
// ciphertext cap. A flat 64KiB total allowance fails at a 256MiB part.
// Format reference: https://c2sp.org/age#payload
export function recoveryAgeCiphertextLimit(plaintextBytes:number){
 if(!Number.isSafeInteger(plaintextBytes)||plaintextBytes<0||plaintextBytes>1024*1024*1024)throw new Error('RECOVERY_ENCRYPTION_SIZE_REVIEW_REQUIRED');
 return Math.min(1024*1024*1024,plaintextBytes+65536+16*Math.max(1,Math.ceil(plaintextBytes/65536)));
}
