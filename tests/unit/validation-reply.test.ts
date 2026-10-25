import {describe,it,expect,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {readValidationReply,fileHash,SandboxValidationError} from '../../src/files/validation-reply.ts';
import {imageValidationVersion,pdfValidationVersion,heicValidationVersion} from '../../src/files/validation-contract.ts';
const original=Buffer.from('synthetic original'),preview=Buffer.from([255,216,1,2,255,217]);
const expected={type:'image/png' as const,byteSize:original.length,sha256:fileHash(original)};
const reply=()=>({status:'Validated',validationVersion:imageValidationVersion,source:{sha256:expected.sha256,byteSize:expected.byteSize,width:20,height:10,detectedType:expected.type},
  preview:{bytes:preview.toString('base64'),sha256:fileHash(preview),byteSize:preview.length,contentType:'image/jpeg',width:20,height:10}});
function valid(){return reply();}
const encode=(r:unknown)=>Buffer.from(JSON.stringify(r));
describe('isolated validation protocol',()=>{
  it('binds a private preview to the exact original snapshot without loading a decoder',()=>{const r=readValidationReply(encode(valid()),0,expected);expect(r.preview.bytes).toEqual(preview);expect(r.source.sha256).toBe(expected.sha256);});
  it('checks PDF pages and the selected first-page preview',()=>{const r=valid(),e={...expected,type:'application/pdf' as const};r.validationVersion=pdfValidationVersion;
    const input={...r,source:{sha256:e.sha256,byteSize:e.byteSize,detectedType:e.type,pageCount:100},preview:{...r.preview,pageNumber:1}};
    expect(readValidationReply(encode(input),0,e).source.pageCount).toBe(100);
    expect(()=>readValidationReply(encode({...input,preview:{...input.preview,pageNumber:2}}),0,e)).toThrow('SANDBOX_PROTOCOL_INVALID');});
  it('checks HEIC display/encoded geometry and source bit depth',()=>{const r=valid(),e={...expected,type:'image/heic' as const};
    const input={...r,validationVersion:heicValidationVersion,source:{...r.source,detectedType:e.type,displayWidth:10,displayHeight:20,bitDepth:10}};
    expect(readValidationReply(encode(input),0,e).source.bitDepth).toBe(10);
    expect(()=>readValidationReply(encode({...input,source:{...input.source,bitDepth:7}}),0,e)).toThrow('SANDBOX_PROTOCOL_INVALID');});
  it.each([
    ['version',(r:ReturnType<typeof valid>)=>{r.validationVersion='unreviewed';}],
    ['source hash',(r:ReturnType<typeof valid>)=>{r.source.sha256='a'.repeat(64);}],
    ['source size',(r:ReturnType<typeof valid>)=>{r.source.byteSize++;}],
    ['source MIME',(r:ReturnType<typeof valid>)=>{r.source.detectedType='image/jpeg' as 'image/png';}],
    ['source pixels',(r:ReturnType<typeof valid>)=>{r.source.width=60_000_000;}],
    ['preview hash',(r:ReturnType<typeof valid>)=>{r.preview.sha256='b'.repeat(64);}],
    ['preview size',(r:ReturnType<typeof valid>)=>{r.preview.byteSize++;}],
    ['preview dimensions',(r:ReturnType<typeof valid>)=>{r.preview.width=2049;}],
    ['preview MIME',(r:ReturnType<typeof valid>)=>{r.preview.contentType='text/html';}],
    ['base64',(r:ReturnType<typeof valid>)=>{r.preview.bytes+='\n';}],
    ['payload',(r:ReturnType<typeof valid>)=>{r.preview.bytes=Buffer.from('not JPEG').toString('base64');r.preview.byteSize=8;r.preview.sha256=fileHash(Buffer.from('not JPEG'));}],
    ['extra source',(r:ReturnType<typeof valid>)=>{Object.assign(r.source,{secret:'private'});}],
    ['extra response',(r:ReturnType<typeof valid>)=>{Object.assign(r,{url:'private'});}],
    ['null source',(r:ReturnType<typeof valid>)=>{Object.assign(r,{source:null});}],
  ])('rejects forged %s',(name,change)=>{void name;const r=valid();change(r);expect(()=>readValidationReply(encode(r),0,expected)).toThrow('SANDBOX_PROTOCOL_INVALID');});
  it.each([null,[],{},'secret native diagnostic',Buffer.alloc(12*1024*1024+1)])('rejects malformed or excessive replies',r=>{expect(()=>readValidationReply(Buffer.isBuffer(r)?r:encode(r),0,expected)).toThrow('SANDBOX_PROTOCOL_INVALID');});
  it('does not accept a valid result with a failed process exit',()=>{expect(()=>readValidationReply(encode(valid()),1,expected)).toThrow('SANDBOX_PROTOCOL_INVALID');});
  it('accepts only known redacted failures for the selected worker and exit',()=>{const body={status:'Quarantined',code:'IMAGE_DECODE_FAILED'};
    try{readValidationReply(encode(body),1,expected);throw Error('not rejected');}catch(e){expect(e).toBeInstanceOf(SandboxValidationError);expect((e as SandboxValidationError).quarantineCode).toBe(body.code);expect((e as Error).cause).toBeUndefined();}
    for(const r of [{...body,code:'PDF_ACTIVE_CONTENT'},{...body,code:'sensitive error'},{...body,detail:'secret'}])expect(()=>readValidationReply(encode(r),1,expected)).toThrow('SANDBOX_PROTOCOL_INVALID');
    expect(()=>readValidationReply(encode(body),0,expected)).toThrow('SANDBOX_PROTOCOL_INVALID');});
});
