import {createHash} from 'node:crypto';
import {expect,it} from 'vitest';
import {legacyPolicyOrderMatches,normalizedSchema} from '../support/recovery-schema-comparison.mjs';

const source=`-- Name: operations accepted; Type: POLICY; Schema: crest_private; Owner: crest_owner
--

CREATE POLICY accepted ON crest_private.operations FOR SELECT TO crest_quote_owner, crest_booking_owner USING (business_id = current_setting('crest.business_id')::uuid);
-- Name: TABLE operations; Type: ACL; Schema: crest_private; Owner: crest_owner
--

GRANT SELECT ON TABLE crest_private.operations TO crest_quote_owner;
`;
const reordered=source.replace('crest_quote_owner, crest_booking_owner','crest_booking_owner, crest_quote_owner');
const roles=[{schemaName:'crest_private',tableName:'operations',policyName:'accepted',roles:['crest_booking_owner','crest_quote_owner']}];
const digest=(s:string)=>createHash('sha256').update(s).digest('hex'),expected=digest(source);

it('requires the exact original authenticated schema digest before comparing verified policy-role presentation',()=>{
 expect(digest(reordered)).not.toBe(expected);
 expect(legacyPolicyOrderMatches(source,reordered,expected,roles)).toBe(true);
 expect(()=>legacyPolicyOrderMatches(reordered,source,expected,roles)).toThrow('authenticated original schema differs');
 expect(()=>legacyPolicyOrderMatches(source,reordered,'0'.repeat(64),roles)).toThrow('authenticated original schema differs');
});

it('does not accept changed predicates, grants, owners, function text, columns or additional statements',()=>{
 for(const modified of [
  reordered.replace("business_id = current_setting('crest.business_id')::uuid",'true'),
  reordered.replace('GRANT SELECT','GRANT ALL'),
  reordered+'ALTER TABLE crest_private.operations DISABLE ROW LEVEL SECURITY;\n',
  reordered+'CREATE FUNCTION crest_private.other() RETURNS int LANGUAGE sql AS \'SELECT 2\';\n',
  reordered+'ALTER TABLE crest_private.operations ADD COLUMN unexpected text;\n',
 ])expect(legacyPolicyOrderMatches(source,modified,expected,roles)).toBe(false);
 expect(()=>legacyPolicyOrderMatches(source,reordered.replace('Owner: crest_owner','Owner: other_owner'),expected,roles)).toThrow();
});

it('rejects changed role sets and incomplete or unsupported policy metadata',()=>{
 expect(()=>legacyPolicyOrderMatches(source,reordered.replace('crest_quote_owner USING','crest_other_owner USING'),expected,roles)).toThrow();
 expect(()=>legacyPolicyOrderMatches(source,reordered,expected,[{...roles[0]!,roles:['crest_booking_owner','crest_other_owner','crest_quote_owner']}])).toThrow();
 expect(legacyPolicyOrderMatches(source,reordered,expected,[])).toBe(false);
 expect(()=>legacyPolicyOrderMatches(source,reordered,expected,[{...roles[0]!,schemaName:'unreviewed'}])).toThrow();
});

it('retains the existing restriction-nonce handling and all other schema bytes',()=>{
 const original='\\restrict Source123\n'+source+'\\unrestrict Source123\n';
 const restored='\\restrict Dest456\n'+reordered+'\\unrestrict Dest456\n';
 expect(legacyPolicyOrderMatches(original,restored,digest(normalizedSchema(original)),roles)).toBe(true);
 expect(normalizedSchema('SELECT 1;\n')).toBe('SELECT 1;\n');
 expect(()=>legacyPolicyOrderMatches(source,reordered.replace('USING (','USING  ('),expected,roles)).toThrow();
});
