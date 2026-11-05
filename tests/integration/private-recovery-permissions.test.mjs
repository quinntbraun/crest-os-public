import assert from 'node:assert/strict';
import {chmod,rm,rmdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {test} from 'node:test';
import {assertPrivateRecoveryArtifact,privateRecoveryWorkspace,recoveryPermissionCommand} from '../support/private-recovery-permissions.mjs';

test('recovery privacy accepts a protected new artifact and rejects an actual additional reader',async()=>{
 const directory=await privateRecoveryWorkspace(),path=join(directory,'nonsecret-permission-sentinel.txt');
 try{
  await writeFile(path,'Fictional test sentinel; no key or business data.',{flag:'wx',mode:0o600});
  await assertPrivateRecoveryArtifact(path);
  if(process.platform==='win32')await recoveryPermissionCommand(`
if($item.Name -ne 'nonsecret-permission-sentinel.txt' -or $item.PSIsContainer){throw 'not_sentinel'}
$acl=Get-Acl -LiteralPath $item.FullName
$everyone=New-Object Security.Principal.SecurityIdentifier('S-1-1-0')
$rule=New-Object Security.AccessControl.FileSystemAccessRule($everyone,'Read','Allow')
$acl.AddAccessRule($rule)
Set-Acl -LiteralPath $item.FullName -AclObject $acl
`,path);
  else await chmod(path,0o644);
  await assert.rejects(assertPrivateRecoveryArtifact(path),{message:/RECOVERY_ARTIFACT_NOT_PRIVATE/});
 }finally{await rm(path,{force:true});await rmdir(directory);}
});
