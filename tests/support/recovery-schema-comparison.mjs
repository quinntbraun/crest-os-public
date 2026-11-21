import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';

export function normalizedSchema(bytes,policyRoleSets=[]){
  // PG17's psql restriction nonce is intentionally random; retain every other
  // schema byte except the presentation order of verified Crest policy roles.
  let sql=bytes.toString().replace(/^\\(?:un)?restrict [A-Za-z0-9]+\r?$/gm,'');
  for(const {schemaName,tableName,policyName,roles} of policyRoleSets){
    if(!roles.every(role=>/^crest_[a-z_]+$/.test(role)))continue;
    assert(['crest','crest_private'].includes(schemaName));
    assert([tableName,policyName].every(name=>/^[a-z_][a-z0-9_]*$/.test(name)));
    const header=`-- Name: ${tableName} ${policyName}; Type: POLICY; Schema: ${schemaName}; Owner: crest_[a-z_]+`;
    const statement=`CREATE POLICY ${policyName} ON ${schemaName}\\.${tableName}(?: AS RESTRICTIVE)?(?: FOR (?:SELECT|INSERT|UPDATE|DELETE))? TO `;
    const line=new RegExp(`^(${header}\\n--\\n\\n${statement})(crest_[a-z_]+(?:, crest_[a-z_]+)+)(?= USING \\(| WITH CHECK \\(|;)`,'gm');
    let found=0;
    sql=sql.replace(line,(_match,prefix,listed)=>{
      assert.deepEqual(listed.split(', ').sort(),roles);
      found++;
      return prefix+roles.join(', ');
    });
    assert.equal(found,1,'dump must contain the exact policy entry');
  }
  return sql;
}
/**
 * @param {string} authenticatedSchema
 * @param {string} restoredSchema
 * @param {string} expectedDigest
 * @param {{schemaName:string,tableName:string,policyName:string,roles:string[]}[]} policyRoles
 */
export function legacyPolicyOrderMatches(authenticatedSchema,restoredSchema,expectedDigest,policyRoles){
 const digest=value=>createHash('sha256').update(value).digest('hex');
 assert.equal(digest(normalizedSchema(authenticatedSchema)),expectedDigest,'authenticated original schema differs');
 // normalizedSchema verifies each exact role set and policy entry before
 // ordering its presentation. Every other byte still participates in the hash.
 return digest(normalizedSchema(authenticatedSchema,policyRoles))===digest(normalizedSchema(restoredSchema,policyRoles));
}
