import {describe,it,expect} from 'vitest';
import {recoveryAgeCiphertextLimit} from '../../src/tooling/recovery-encryption-limits.ts';
describe('bounded standard age payload overhead',()=>{
 it('accounts for tags on both sides of each 64KiB boundary',()=>{expect(recoveryAgeCiphertextLimit(65536)).toBe(65536+65536+16);expect(recoveryAgeCiphertextLimit(65537)).toBe(65537+65536+32);});
 it('allows header and all tags for the default 256MiB release part',()=>{const size=256*1024*1024;expect(recoveryAgeCiphertextLimit(size)).toBe(size+131072);});
 it('preserves the absolute 1GiB ciphertext limit',()=>{expect(recoveryAgeCiphertextLimit(1024*1024*1024-65536)).toBe(1024*1024*1024);});
 it('handles an empty plaintext without unbounded allowance',()=>{expect(recoveryAgeCiphertextLimit(0)).toBe(65552);});
 it.each([-1,0.5,NaN,Infinity,1024*1024*1024+1])('refuses invalid plaintext size %s',value=>{expect(()=>recoveryAgeCiphertextLimit(value)).toThrow('RECOVERY_ENCRYPTION_SIZE_REVIEW_REQUIRED');});
});
