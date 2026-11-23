import {it,expect} from 'vitest';
import {readRecoveryCaptureProfile} from '../../src/tooling/recovery-capture-profile.ts';
import {recoveryCaptureProfileFixture} from '../support/recovery-capture-profile-fixture.mjs';
it('retains only the explicit immutable private capture configuration',()=>{
 const original=recoveryCaptureProfileFixture(),capture=readRecoveryCaptureProfile(original),value=capture.forRecoveryTools();expect(()=>JSON.stringify(capture)).toThrow('RECOVERY_CAPTURE_PROFILE_REVIEW_REQUIRED');expect(value.vault.endpoint).toBe(original.vault.endpoint);expect(Object.isFrozen(value.sources.expense_receipt)).toBe(true);const before=value.vault.secretAccessKey;original.vault.secretAccessKey='changed';expect(value.vault.secretAccessKey).toBe(before);
});
it.each([7,35,400])('accepts only the adopted explicit retention tier%s',(days)=>{expect(readRecoveryCaptureProfile({...recoveryCaptureProfileFixture(),retentionDays:days}).forRecoveryTools().retentionDays).toBe(days);});
it('refuses private decryption keys and unknown fields rather than carrying them into a backup job',()=>{
 expect(()=>readRecoveryCaptureProfile({...recoveryCaptureProfileFixture(),privateAgeKey:'not-accepted'})).toThrow('RECOVERY_CAPTURE_PROFILE_REVIEW_REQUIRED');
});
it.each(['http://s3.us-west-004.backblazeb2.com','https://s3.us-west-004.backblazeb2.com?key=value','https://s3.us-west-004.backblazeb2.com/path','https://other.example.test','https://s3.us-east-005.backblazeb2.com'])('refuses a noncanonical or mismatched vault endpoint%s',(endpoint)=>{
 const profile=recoveryCaptureProfileFixture();profile.vault.endpoint=endpoint;expect(()=>readRecoveryCaptureProfile(profile)).toThrow('RECOVERY_CAPTURE_PROFILE_REVIEW_REQUIRED');
});
it.each(['https://hc-ping.com/not-a-uuid','http://hc-ping.com/00000000-0000-4000-8000-000000000000','https://hc-ping.com/00000000-0000-4000-8000-000000000000?create=1'])('refuses unsafe monitor configuration%s',(monitorPingUrl)=>{expect(()=>readRecoveryCaptureProfile({...recoveryCaptureProfileFixture(),monitorPingUrl})).toThrow('RECOVERY_CAPTURE_PROFILE_REVIEW_REQUIRED');});
it('refuses TLS-option overrides, relative files, bad chunk sizes and mixed primary buckets',()=>{
 const original=recoveryCaptureProfileFixture();
 for(const profile of[{...original,databaseUrl:original.databaseUrl+'?sslmode=disable'},{...original,rootCertificateFile:'relative.pem'},{...original,retentionDays:0},{...original,distribution:{...original.distribution,partByteSize:1}},{...original,sources:{...original.sources,condition_photo:original.sources.expense_receipt}}])expect(()=>readRecoveryCaptureProfile(profile)).toThrow('RECOVERY_CAPTURE_PROFILE_REVIEW_REQUIRED');
});
