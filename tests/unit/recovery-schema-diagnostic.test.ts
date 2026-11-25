import {createHash} from 'node:crypto';
import {expect,it} from 'vitest';
import {rememberRecoverySchema,recoverySchemaDifference} from '../support/recovery-schema-diagnostic.mjs';

const header='-- Name: private_record; Type: TABLE; Schema: crest; Owner: crest_owner\n--\n\n';
const original=header+'CREATE TABLE crest.private_record (value text DEFAULT \'PRIVATE_CUSTOMER_SECRET\');\n';
const options={schemaVersion:54,roleOrderMatches:true};

it('retains the exact original digest without normalizing schema or permission bytes',()=>{
 const expected=rememberRecoverySchema(original);
 expect(expected).toBe(createHash('sha256').update(original).digest('hex'));
 expect(recoverySchemaDifference(expected,original,options)).toMatchObject({sourceEvidenceAvailable:true,differenceCount:0,actualDigest:expected});
 const changed=original.replace('value text','value text NOT NULL');
 expect(recoverySchemaDifference(expected,changed,options)).toMatchObject({differenceCount:1,differences:[{kind:'TABLE',schema:'crest',change:'changed'}]});
});

it('reports permission and policy ordering differences without accepting them as equivalent',()=>{
 const sql='-- Name: private_record visible; Type: POLICY; Schema: crest; Owner: crest_owner\n--\n\nCREATE POLICY visible ON crest.private_record TO crest_web, crest_export USING (true);\n';
 const expected=rememberRecoverySchema(sql),changed=sql.replace('crest_web, crest_export','crest_export, crest_web');
 const report=recoverySchemaDifference(expected,changed,{...options,roleOrderMatches:false});
 expect(report.actualDigest).not.toBe(report.expectedDigest);expect(report.roleOrderMatches).toBe(false);
 expect(report.differences).toEqual([expect.objectContaining({kind:'POLICY',change:'changed'})]);
});

it('never reports raw SQL, names, credentials or private source values',()=>{
 const expected=rememberRecoverySchema(original),report=recoverySchemaDifference(expected,original.replace('PRIVATE_CUSTOMER_SECRET','PASSWORD_TOKEN_OTHER'),options),text=JSON.stringify(report);
 for(const value of ['private_record','crest_owner','CREATE TABLE','PRIVATE_CUSTOMER_SECRET','PASSWORD_TOKEN_OTHER'])expect(text).not.toContain(value);
 expect(report.differences[0]?.objectIdentitySha256).toMatch(/^[a-f0-9]{64}$/);
});

it('distinguishes absent source evidence and bounds the reported differences',()=>{
 expect(recoverySchemaDifference('0'.repeat(64),original,options)).toMatchObject({sourceEvidenceAvailable:false,differenceCount:null,differences:[]});
 const source=Array.from({length:20},(_,i)=>header.replace('private_record','record_'+i)+'SELECT 1;\n').join('');
 const report=recoverySchemaDifference(rememberRecoverySchema(source),source.replaceAll('SELECT 1','SELECT 2'),options);
 expect(report.differenceCount).toBe(20);expect(report.differences).toHaveLength(12);expect(report.truncated).toBe(true);
});
