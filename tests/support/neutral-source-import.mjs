// Independent projection reconstruction, not a full application restore. The
// fixture creates a fresh template0 database; no application schema, provider,
// extension, source command, retained session or network service is imported.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
const entities=['businesses','memberships','business_recovery_authorities','actors','role_capabilities','identity_events','operations','audit_events','customers','addresses','vehicles','customer_vehicles','lead_sources','leads','lead_events','lead_vehicles','lead_addresses','lead_conversions','conversion_links'];
const q=name=>{assert.match(name,/^[a-z][a-z0-9_]{0,63}$/);return '"'+name+'"';};
const table=name=>'neutral_source.'+q(name);
const booleanColumns=new Set(['active','writes_enabled','outreach_opt_out','is_billing']),integerColumns=new Set(['year','schema_version','result_schema_version']),jsonColumns=new Set(['source_snapshot','reported_vehicle','requested_services','request']);
export async function exerciseNeutralSourceImport(sandbox,verified){
 const rows=verified.forServer().rows;assert.deepEqual(Object.keys(rows).sort(),entities.slice().sort());for(const entity of entities)assert(rows[entity].length>0,'native import must exercise '+entity);
 const connection=await sandbox.connect(await sandbox.database());
 try{
  assert.deepEqual((await connection.query('SELECT extname FROM pg_extension ORDER BY extname')).rows.map(row=>row.extname),['plpgsql']);
  assert.equal((await connection.query("SELECT count(*)::int AS n FROM pg_namespace WHERE nspname IN('auth','crest','crest_private','crest_commands')")).rows[0].n,0);
  await connection.query('BEGIN');await connection.query('SET LOCAL search_path=pg_catalog');await connection.query('CREATE SCHEMA neutral_source');
  for(const entity of entities){
   const columns=Object.keys(rows[entity][0]);
   await connection.query(`CREATE TABLE ${table(entity)} (${columns.map(column=>q(column)+' '+(booleanColumns.has(column)?'boolean':integerColumns.has(column)?'integer':'text')+(column==='id'?' PRIMARY KEY':'')).join(',')})`);
   for(const row of rows[entity])await connection.query(`INSERT INTO ${table(entity)} (${columns.map(q).join(',')}) VALUES (${columns.map((_,i)=>'$'+(i+1)).join(',')})`,columns.map(column=>row[column]!==null&&jsonColumns.has(column)?JSON.stringify(row[column]):row[column]));
  }
  let constraint=0;
  async function foreign(entity,columns,target,targetColumns=['id']){await connection.query(`ALTER TABLE ${table(entity)} ADD CONSTRAINT ${q('fk_'+(++constraint))} FOREIGN KEY (${columns.map(q).join(',')}) REFERENCES ${table(target)} (${targetColumns.map(q).join(',')})`);}
  for(const entity of entities){
   const columns=Object.keys(rows[entity][0]);if(columns.includes('business_id'))await foreign(entity,['business_id'],'businesses');
   for(const column of ['created_by','updated_by','actor_id'])if(columns.includes(column))await foreign(entity,[column],'actors');
  }
  const relationships={addresses:{customer_id:'customers'},customer_vehicles:{customer_id:'customers',vehicle_id:'vehicles'},lead_sources:{referral_customer_id:'customers'},leads:{customer_id:'customers',source_id:'lead_sources'},lead_events:{lead_id:'leads'},lead_vehicles:{lead_id:'leads',vehicle_id:'vehicles'},lead_addresses:{lead_id:'leads'},lead_conversions:{lead_id:'leads',customer_id:'customers'},conversion_links:{conversion_id:'lead_conversions',lead_id:'leads',lead_vehicle_id:'lead_vehicles',vehicle_id:'vehicles',lead_address_id:'lead_addresses',address_id:'addresses'}};
  for(const [entity,fields]of Object.entries(relationships))for(const [column,target]of Object.entries(fields))await foreign(entity,[column],target);
  for(const column of ['lead_before_audit_id','lead_audit_id','customer_audit_id'])await foreign('lead_conversions',[column],'audit_events');
  for(const column of ['source_audit_id','target_audit_id'])await foreign('conversion_links',[column],'audit_events');
  await connection.query('ALTER TABLE neutral_source.operations ADD UNIQUE(business_id,operation_id)');await foreign('audit_events',['business_id','operation_id'],'operations',['business_id','operation_id']);
  for(const entity of ['lead_vehicles','lead_addresses','lead_conversions'])await connection.query(`ALTER TABLE ${table(entity)} ADD UNIQUE(id,lead_id)`);
  await foreign('conversion_links',['lead_vehicle_id','lead_id'],'lead_vehicles',['id','lead_id']);await foreign('conversion_links',['lead_address_id','lead_id'],'lead_addresses',['id','lead_id']);await foreign('conversion_links',['conversion_id','lead_id'],'lead_conversions',['id','lead_id']);
  assert.equal((await connection.query('SELECT count(*)::int AS n FROM neutral_source.conversion_links l JOIN neutral_source.lead_conversions c ON c.id=l.conversion_id JOIN neutral_source.addresses a ON a.id=l.address_id WHERE a.customer_id<>c.customer_id')).rows[0].n,0);
  for(const entity of ['actors','role_capabilities','businesses','memberships','business_recovery_authorities'])assert.equal((await connection.query(`SELECT count(*)::int AS n FROM neutral_source.identity_events e LEFT JOIN ${table(entity)} t ON t.id=e.entity_id WHERE e.entity_kind=$1 AND t.id IS NULL`,[entity])).rows[0].n,0);
  for(const entity of entities){
   const actual=(await connection.query(`SELECT * FROM ${table(entity)} ORDER BY id`)).rows.map(row=>Object.fromEntries(Object.entries(row).map(([column,value])=>[column,value!==null&&jsonColumns.has(column)?JSON.parse(value):value])));
   assert.deepEqual(actual,rows[entity],entity+' must reconstruct every CSV column with exact text/JSON/scalar types');
  }
  await connection.query('SAVEPOINT rejected_foreign');const source=rows.customer_vehicles[0],columns=Object.keys(source),invalid={...source,id:randomUUID(),vehicle_id:randomUUID()};
  await assert.rejects(connection.query(`INSERT INTO neutral_source.customer_vehicles (${columns.map(q).join(',')}) VALUES (${columns.map((_,i)=>'$'+(i+1)).join(',')})`,columns.map(column=>invalid[column])),error=>error.code==='23503');
  await connection.query('ROLLBACK TO SAVEPOINT rejected_foreign');assert.equal((await connection.query('SELECT count(*)::int AS n FROM neutral_source.customer_vehicles')).rows[0].n,rows.customer_vehicles.length);
  await connection.query('COMMIT');
 }catch(error){await connection.query('ROLLBACK');throw error;}
 finally{await connection.end();}
}
