// Synthetic recovery fixtures only. Never changes an existing workspace or host policy.
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {chmod,lstat,mkdir,mkdtemp,realpath} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';

const execute=promisify(execFile);
const base=fileURLToPath(new URL('../../.local/recovery-drill/',import.meta.url));
const windowsPrelude=`$ErrorActionPreference='Stop'
Import-Module (Join-Path $PSHOME 'Modules/Microsoft.PowerShell.Security/Microsoft.PowerShell.Security.psd1')
$item=Get-Item -LiteralPath $env:CREST_TEST_PRIVATE_ARTIFACT -Force
if(($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){throw 'reparse'}
$me=[Security.Principal.WindowsIdentity]::GetCurrent().User
`;
export async function recoveryPermissionCommand(script,path){
 assert.equal(process.env.CREST_ENV,'test');
 assert.equal(process.platform,'win32');
 // Fixed system executable and fixed scripts; the filename is data, never command text.
 const executable=join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe');
 try{return (await execute(executable,['-NoLogo','-NoProfile','-NonInteractive','-Command',windowsPrelude+script],{env:{...process.env,CREST_TEST_PRIVATE_ARTIFACT:path},encoding:'utf8',timeout:15000,maxBuffer:4096})).stdout.trim();}
 catch{throw new Error('SYNTHETIC_RECOVERY_PERMISSIONS_FAILED');}
}
export async function privateRecoveryWorkspace(){
 assert.equal(process.env.CREST_ENV,'test');
 await mkdir(base,{recursive:true,mode:0o700});
 const directory=await mkdtemp(join(base,'case-'));
 assert.equal(await realpath(directory),resolve(directory));
 if(process.platform!=='win32')await chmod(directory,0o700);
 else await recoveryPermissionCommand(`
if(-not $item.PSIsContainer -or @(Get-ChildItem -LiteralPath $item.FullName -Force).Count -ne 0){throw 'not_empty_directory'}
$acl=New-Object Security.AccessControl.DirectorySecurity
$acl.SetOwner($me)
$acl.SetAccessRuleProtection($true,$false)
foreach($sid in @($me.Value,'S-1-5-18','S-1-5-32-544')){
 $identity=New-Object Security.Principal.SecurityIdentifier($sid)
 $rule=New-Object Security.AccessControl.FileSystemAccessRule($identity,'FullControl','ContainerInherit,ObjectInherit','None','Allow')
 $acl.AddAccessRule($rule)
}
Set-Acl -LiteralPath $item.FullName -AclObject $acl
`,directory);
 return directory;
}
export async function assertPrivateRecoveryArtifact(path){
 assert.equal(process.env.CREST_ENV,'test');
 const info=await lstat(path);assert(info.isFile()&&!info.isSymbolicLink(),'PRIVATE_RECOVERY_ARTIFACT_REQUIRED');
 if(process.platform!=='win32'){assert.equal(info.mode&0o077,0,'RECOVERY_ARTIFACT_NOT_PRIVATE');return;}
 const result=await recoveryPermissionCommand(`
if($item.PSIsContainer){throw 'not_file'}
$acl=Get-Acl -LiteralPath $item.FullName
$owner=$acl.GetOwner([Security.Principal.SecurityIdentifier]).Value
$allowed=@($me.Value,'S-1-5-18','S-1-5-32-544')
$raw=New-Object Security.AccessControl.RawSecurityDescriptor($acl.Sddl)
$private=($null -ne $raw.DiscretionaryAcl) -and ($owner -eq $me.Value)
$ownAccess=$false
foreach($rule in $acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])){
 if($rule.AccessControlType -eq 'Allow' -and ($rule.PropagationFlags -band [Security.AccessControl.PropagationFlags]::InheritOnly) -eq 0){
  if($allowed -notcontains $rule.IdentityReference.Value){$private=$false}
  if($rule.IdentityReference.Value -eq $me.Value -and ($rule.FileSystemRights -band [Security.AccessControl.FileSystemRights]::FullControl) -eq [Security.AccessControl.FileSystemRights]::FullControl){$ownAccess=$true}
 }
}
if($private -and $ownAccess){'private'}else{'not_private'}
`,path);
 assert.equal(result,'private','RECOVERY_ARTIFACT_NOT_PRIVATE');
}
