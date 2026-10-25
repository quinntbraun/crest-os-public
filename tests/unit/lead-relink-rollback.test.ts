import {beforeEach,it,expect,vi} from 'vitest';
vi.mock('server-only',()=>({}));
const mock=vi.hoisted(()=>({query:vi.fn(),end:vi.fn(),events:[] as string[]}));
vi.mock('pg',()=>({default:{Client:class{
 on(){return this;}once(){return this;}async connect(){mock.events.push('connect');}
 async end(){mock.events.push('end');return mock.end();}
 query(text:string,values?:unknown[]){mock.events.push(text);return mock.query(text,values);}
}}}));
import {sessionDatabase} from '../../src/security/session-database';
const sql='SELECT crest_commands.save_lead($1::bytea,$2::uuid,$3::uuid,$4::text,$5::uuid,$6::uuid,$7::timestamptz,$8::uuid,$9::uuid,$10::uuid,$11::integer,$12::uuid,$13::bigint,$14::jsonb) AS result';
const denied=(code='55000',message='CREST_CONVERTED_CUSTOMER_IMMUTABLE')=>Object.assign(new Error(message),{code,detail:'private SQL parameters',hint:'private hint'});
const database=()=>sessionDatabase({environment:'test',connectionString:'postgres://synthetic:synthetic@127.0.0.1:54322/crest_migrate_1234567890abcdef'});
const signal=()=>new AbortController().signal;
beforeEach(()=>{vi.resetAllMocks();mock.events.length=0;mock.end.mockResolvedValue(undefined);mock.query.mockImplementation(async(text:string)=>{
 if(text.startsWith("SELECT current_user="))return {rows:[{allowed:true}]};
 if(text===sql)throw denied();return {rows:[{result:null}],command:text==='ROLLBACK'?'ROLLBACK':text==='COMMIT'?'COMMIT':'SET'};
});});
it('emits only the fixed known conflict after the failed lead statement and acknowledged rollback',async()=>{
 const e=await database().commandTransaction(q=>q(sql,[]),signal()).catch(e=>e);
 expect(e).toMatchObject({message:'LEAD_CONVERTED_CUSTOMER_IMMUTABLE'});expect(e).not.toHaveProperty('cause');expect(e).not.toHaveProperty('detail');expect(e).not.toHaveProperty('code');expect(mock.events.slice(-3)).toEqual([sql,'ROLLBACK','end']);expect(mock.events).not.toContain('COMMIT');
});
it.each([['23514','CREST_CONVERTED_CUSTOMER_IMMUTABLE'],['55000','different private error']])('keeps code/message mismatch %s private',async(code,message)=>{
 mock.query.mockImplementation(async(text:string)=>{if(text.startsWith('SELECT current_user='))return {rows:[{allowed:true}]};if(text===sql)throw denied(code,message);return {command:'ROLLBACK',rows:[]};});
 await expect(database().commandTransaction(q=>q(sql,[]),signal())).rejects.toThrow('SESSION_DATABASE_FAILED');
});
it.each(['failed','wrongAcknowledgement'])('does not claim a definite outcome after %s rollback',async which=>{
 const original=mock.query.getMockImplementation()!;mock.query.mockImplementation(async(text:string,...rest:unknown[])=>{if(text==='ROLLBACK'){if(which==='failed')throw new Error('private rollback error');return {command:'COMMIT'};}return original(text,...rest);});
 await expect(database().commandTransaction(q=>q(sql,[]),signal())).rejects.toThrow('SESSION_DATABASE_FAILED');
});
it('refuses a matching raw error from a different statement or untrusted callback',async()=>{
 const original=mock.query.getMockImplementation()!;mock.query.mockImplementation(async(text:string,...rest:unknown[])=>text==='SELECT other AS result'?Promise.reject(denied()):original(text,...rest));
 await expect(database().commandTransaction(q=>q('SELECT other AS result',[]),signal())).rejects.toThrow('SESSION_DATABASE_FAILED');
 await expect(database().commandTransaction(async()=>{throw denied();},signal())).rejects.toThrow('SESSION_DATABASE_FAILED');
});
it('does not translate a read-only call, swallowed statement failure or failed commit',async()=>{
 await expect(database()(sql,[],signal())).rejects.toThrow('SESSION_DATABASE_FAILED');
 const original=mock.query.getMockImplementation()!;mock.query.mockImplementation(async(text:string,...rest:unknown[])=>text==='COMMIT'?{command:'ROLLBACK'}:original(text,...rest));
 await expect(database().commandTransaction(async q=>{try{await q(sql,[]);}catch{/* swallowed by a faulty caller */}return 'incorrect';},signal())).rejects.toThrow('SESSION_DATABASE_FAILED');
 mock.query.mockImplementation(async(text:string,...rest:unknown[])=>text==='COMMIT'?Promise.reject(denied()):original(text,...rest));
 await expect(database().commandTransaction(async()=>null,signal())).rejects.toThrow('SESSION_DATABASE_FAILED');
});
it('cancellation while rolling back remains unknown',async()=>{
 const controller=new AbortController(),original=mock.query.getMockImplementation()!;mock.query.mockImplementation(async(text:string,...rest:unknown[])=>{if(text==='ROLLBACK')controller.abort();return original(text,...rest);});
 await expect(database().commandTransaction(q=>q(sql,[]),controller.signal)).rejects.toThrow('SESSION_DATABASE_FAILED');
});
