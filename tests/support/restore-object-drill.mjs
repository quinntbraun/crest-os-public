import {readFile} from 'node:fs/promises';
import {restoreObjectArchive} from '../../src/tooling/object-recovery.ts';
import {objectDirectory,decryptor} from './object-recovery-drill.mjs';
const [request,identity,vaultPath,destinationPath]=process.argv.slice(2);
const {receipt,inventory}=JSON.parse(await readFile(request,'utf8'));
const vault=await objectDirectory(vaultPath),destination=await objectDirectory(destinationPath);
await restoreObjectArchive(receipt,inventory,{readVault:vault.read,unseal:decryptor(identity),putDestination:destination.put,readDestination:destination.read});
console.log('Synthetic private object restore completed');
