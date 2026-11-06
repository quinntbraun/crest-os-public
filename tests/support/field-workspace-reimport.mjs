// Independent CSV reconstruction in an empty neutral PostgreSQL database.
// Not an application restore: no app functions, RLS, sessions or commands.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readCustomerCsv} from './customer-fixture.ts';
import {reimportAcceptedSourceTables,acceptedSourceTables} from './accepted-amendment-source-csv.mjs';
import {fieldSourceGroups,fieldSourceSchema} from '../../src/operations/field-source-schema.ts';
const quote=s=>{assert.match(s,/^[a-z][a-z0-9_]{0,63}$/);return '"'+s+'"';};
const table=s=>'public.'+quote('restored_'+s),booleans=new Set(['active','writes_enabled','outreach_opt_out','is_billing']),integers=new Set(['year','schema_version','result_schema_version']);
function decode(text,escapes,entity){
 const matrix=readCustomerCsv(text),columns=matrix.shift();assert(columns.includes('id'));
 const rows=matrix.map(cells=>{const id=cells[columns.indexOf('id')];return Object.fromEntries(columns.map((column,i)=>{
  let cell=cells[i];if(cell==='\\N')return [column,null];
  if(escapes.some(e=>(e.entity===undefined||e.entity===entity)&&e.row_id===id&&e.column===column)){assert(cell.startsWith("'"));cell=cell.slice(1);}
  cell=cell.replaceAll('\\\\','\\');return [column,booleans.has(column)?(assert(cell==='true'||cell==='false'),cell==='true'):integers.has(column)?Number(cell):cell];
 }));});return {columns,rows};
}
export async function reimportFieldWorkspaceSources(c,bundle,commercial,workspace){
 assert.equal((await c.query("SELECT count(*)::int n FROM pg_class cl JOIN pg_namespace n ON n.oid=cl.relnamespace WHERE cl.relkind='r' AND n.nspname !~ '^pg_' AND n.nspname<>'information_schema'")).rows[0].n,0);
 const files=new Map(bundle.parts.map(p=>[p.name,p.content])),manifest=JSON.parse(bundle.manifest);
 for(const part of manifest.parts){const content=files.get(part.name);assert.equal(Buffer.byteLength(content),part.bytes);assert.equal(createHash('sha256').update(content).digest('hex'),part.sha256);}
 const accepted=await reimportAcceptedSourceTables(c,commercial),columnsByTable=new Map(acceptedSourceTables(commercial).map(s=>[s.entity,s.columns]));
 const entities=['businesses','memberships','business_recovery_authorities','actors','role_capabilities','identity_events','operations','audit_events','customers','addresses','vehicles','customer_vehicles'];
 const original={};
 for(const entity of entities){
  const candidates=bundle.parts.filter(p=>p.name.endsWith('_dictionary.json')).map(p=>JSON.parse(p.content)).filter(d=>d.entity===entity&&Array.isArray(d.columns));assert.equal(candidates.length,1);
  const maps=bundle.parts.filter(p=>p.name.endsWith('_escape_map.json')).map(p=>JSON.parse(p.content)).filter(d=>d.entity===entity);assert.equal(maps.length,1);
  const {columns,rows}=decode(files.get(entity+'.csv'),maps[0].escapes,entity);assert.deepEqual(columns,candidates[0].columns);columnsByTable.set(entity,columns);original[entity]=rows;
  const type=column=>column==='id'||['business_id','actor_id','created_by','updated_by','closed_by','operation_id','customer_id','vehicle_id'].includes(column)?'uuid':booleans.has(column)?'boolean':integers.has(column)?'integer':'text';
  await c.query('CREATE TABLE '+table(entity)+'('+columns.map(column=>quote(column)+' '+type(column)+(column==='id'?' PRIMARY KEY':'')).join(',')+')');
  for(const row of rows)await c.query('INSERT INTO '+table(entity)+' VALUES('+columns.map((_,i)=>'$'+(i+1)).join(',')+')',columns.map(k=>row[k]));
  assert.deepEqual((await c.query('SELECT to_jsonb(t) value FROM '+table(entity)+' t ORDER BY id')).rows.map(r=>r.value),rows.slice().sort((a,b)=>a.id<b.id?-1:1));
 }
 const fieldEscapes=JSON.parse(files.get('field_source_escape_map.json')).escapes;
 for(const group of fieldSourceGroups){
  const fields=fieldSourceSchema[group].fields,{columns,rows}=decode(files.get(group+'.csv'),fieldEscapes,group);assert.deepEqual(columns,Object.keys(fields));columnsByTable.set(group,columns);
  await c.query('CREATE TABLE '+table(group)+'('+Object.entries(fields).map(([name,spec])=>quote(name)+' '+spec.type+(spec.nullable?'':' NOT NULL')+(name==='id'?' PRIMARY KEY':'')).join(',')+')');
  for(const row of rows)await c.query('INSERT INTO '+table(group)+' VALUES('+columns.map((_,i)=>'$'+(i+1)).join(',')+')',columns.map(k=>row[k]));
  const projection=Object.entries(fields).map(([name,spec])=>"'"+name+"',"+(spec.type==='jsonb'||spec.type==='bigint'||spec.type.startsWith('numeric')?quote(name)+'::text':spec.type==='timestamp with time zone'?"to_char("+quote(name)+" AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"')":quote(name))).join(',');
  assert.deepEqual((await c.query('SELECT jsonb_build_object('+projection+') value FROM '+table(group)+' ORDER BY id')).rows.map(r=>r.value),[...workspace.field.rows[group]].sort((a,b)=>a.id<b.id?-1:1));
 }
 let foreignKeys=accepted.foreignKeys;const unique=new Set();
 async function foreign(entity,columns,target,targetColumns=['id']){
  assert(columnsByTable.has(entity)&&columnsByTable.has(target));const key=target+':'+targetColumns.join(',');
  if(!unique.has(key)){await c.query('ALTER TABLE '+table(target)+' ADD UNIQUE('+targetColumns.map(quote).join(',')+')');unique.add(key);}
  await c.query('ALTER TABLE '+table(entity)+' ADD FOREIGN KEY('+columns.map(quote).join(',')+') REFERENCES '+table(target)+'('+targetColumns.map(quote).join(',')+') DEFERRABLE INITIALLY DEFERRED');foreignKeys++;
 }
 for(const [entity,columns]of columnsByTable){
  if(columns.includes('business_id'))await foreign(entity,['business_id'],'businesses');
  for(const key of ['created_by','updated_by','actor_id','operator_actor_id','confirmed_by','closed_by'])if(columns.includes(key))await foreign(entity,[key],'actors');
 }
 for(const group of fieldSourceGroups)for(const fk of fieldSourceSchema[group].foreignKeys)await foreign(group,fk.columns,fk.target.slice(fk.target.indexOf('.')+1),fk.targetColumns);
 for(const [entity,fields]of Object.entries({addresses:{customer_id:'customers'},customer_vehicles:{customer_id:'customers',vehicle_id:'vehicles'},jobs:{customer_id:'customers',work_address_id:'addresses'},job_vehicles:{vehicle_id:'vehicles',customer_vehicle_id:'customer_vehicles'},agreements:{customer_id:'customers'},scope_entitlements:{vehicle_id:'vehicles'}}))for(const [column,parent]of Object.entries(fields))await foreign(entity,[column],parent);
 assert.equal(columnsByTable.size,47);
 return {tables:columnsByTable.size,foreignKeys,allFieldColumns:fieldSourceGroups.reduce((n,g)=>n+Object.keys(fieldSourceSchema[g].fields).length,0),applicationRestore:false};
}
