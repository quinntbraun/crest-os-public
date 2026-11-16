import 'server-only';
import {lstat,readFile} from 'node:fs/promises';
import {Readable} from 'node:stream';
import {fileURLToPath} from 'node:url';
import {GetObjectCommand,S3Client} from '@aws-sdk/client-s3';
import {createReceiptObjectStore} from '../bookkeeping/expenses/receipt-object-store.ts';

export const supplierStoreError=()=>Error('SYNTHETIC_SUPPLIER_DOCUMENT_CONFIGURATION_REQUIRED');
export const workspaceIdPattern=/^[a-f0-9]{16}$/;
export const workspaceUuidPattern=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export async function readSupplierProfile(path:URL){
 const stat=await lstat(fileURLToPath(path));
 if(!stat.isFile()||stat.isSymbolicLink()||stat.size<1||stat.size>16384)throw supplierStoreError();
 return JSON.parse(await readFile(path,'utf8'));
}

type Configuration={
 version:1;workspaceId:string;origin:string;bucket:string;
 credentials:{accessKeyId:string;secretAccessKey:string};
};
export async function openSyntheticSupplierStore(config:Configuration,workspaceId:string){
 const {origin,bucket,credentials}=config,url=new URL(origin);
 if(config.version!==1||config.workspaceId!==workspaceId||!workspaceIdPattern.test(workspaceId)||
  url.origin!==origin||url.protocol!=='http:'||url.hostname!=='127.0.0.1'||Number(url.port)<1024||
  !/^crest-(?:synthetic|fictional)-[a-z0-9-]{3,40}$/.test(bucket)||
  !/^[A-Za-z0-9_-]{16,64}$/.test(credentials.accessKeyId)||! /^[A-Za-z0-9_-]{32,128}$/.test(credentials.secretAccessKey))
  throw supplierStoreError();
 const client=new S3Client({endpoint:origin,region:'us-east-1',forcePathStyle:true,credentials,maxAttempts:1,
  requestChecksumCalculation:'WHEN_REQUIRED',responseChecksumValidation:'WHEN_REQUIRED',
  requestHandler:{connectionTimeout:1000,requestTimeout:10000,throwOnRequestTimeout:true}});
 try{
  const expected=Buffer.from('crest synthetic storage '+workspaceId);
  const signal=AbortSignal.timeout(5000);
  const marker=await client.send(new GetObjectCommand({Bucket:bucket,Key:'originals/_crest_store_identity'}),{abortSignal:signal});
  const body=marker.Body;
  if(!(body instanceof Readable))throw supplierStoreError();
  const abort=()=>body.destroy(supplierStoreError());
  signal.addEventListener('abort',abort,{once:true});
  let size=0;
  try{
   if(signal.aborted||marker.ContentLength!==expected.length||marker.ContentType!=='application/octet-stream')throw supplierStoreError();
   for await(const value of body){
    if(signal.aborted||!(value instanceof Uint8Array)||size+value.byteLength>expected.length||
     !Buffer.from(value).equals(expected.subarray(size,size+value.byteLength)))throw supplierStoreError();
    size+=value.byteLength;
   }
   if(signal.aborted||size!==expected.length)throw supplierStoreError();
  }finally{signal.removeEventListener('abort',abort);body.destroy();}
  return {stagingOrigin:origin,bucket,objects:createReceiptObjectStore(client,bucket),close:()=>client.destroy()};
 }catch{
  client.destroy();
  throw supplierStoreError();
 }
}
