import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {mkdir,rm,rmdir} from 'node:fs/promises';
import {join} from 'node:path';
import {test} from 'node:test';
import {migrationSandbox} from '../support/migration-sandbox.mjs';
import {installProviderSchema} from '../support/provider-schema.mjs';
import {requireSyntheticFinanceAccountConfiguration} from '../../scripts/synthetic-migrations.mjs';
import {requireSyntheticFinancePreviewConnection} from '../../scripts/synthetic-finance-preview.mjs';
import {
  backupDatabase, backupLegacy70Database, connect, inventory, keyPair,
  privateWorkspace, recoveryCluster, restoreDatabase, restoreLegacy70Database,
} from '../support/recovery-drill.mjs';
import {financeAccountSourceColumns,formatFinanceAccountSource} from '../../src/bookkeeping/finance-account-source.ts';
import {readSourceExportCsv} from '../../src/security/source-export-csv-reader.ts';

const auditReason = 'Fictional account review \\N';
const accountDefinition = {
  code:'1000', accountType:'asset', normalSide:'debit',
  controlKind:'bank', reportRole:'money', currency:'USD'
};

async function transaction(db, run) {
  await db.query('BEGIN');
  try {
    const result = await run();
    await db.query('COMMIT');
    return result;
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  }
}

async function businessFixture(db, label) {
  return transaction(db, async () => {
    const bootstrap = (await db.query("SELECT id FROM crest_private.actors WHERE system_key='security_bootstrap'")).rows[0].id;
    const subject = randomUUID(), issuer = 'https://auth.example.com/auth/v1';
    const actor = (await db.query(`
      INSERT INTO crest_private.actors(kind,display_label,auth_provider_issuer,auth_user_id,created_by,updated_by,origin)
      VALUES('owner',$1,$2,$3,$4,$4,'manual') RETURNING id
    `, [label, issuer, subject, bootstrap])).rows[0].id;
    const business = (await db.query(`
      INSERT INTO crest.businesses(legal_name,timezone,created_by,updated_by,origin)
      VALUES($1,'America/Indiana/Indianapolis',$2,$2,'manual') RETURNING id
    `, [label, actor])).rows[0].id;
    await db.query("INSERT INTO crest.memberships(business_id,actor_id,role,created_by,updated_by,origin) VALUES($1,$2,'owner',$2,$2,'manual')",
      [business, actor]);
    const authority = (await db.query(`
      INSERT INTO crest_private.business_recovery_authorities(business_id,writes_enabled,created_by,updated_by,origin)
      VALUES($1,true,$2,$2,'manual') RETURNING id,active_epoch
    `, [business, actor])).rows[0];
    await db.query("INSERT INTO auth.users(id,email,aud,role) VALUES($1,$2,'authenticated','authenticated')",
      [subject,'finance-fixture-'+subject+'@example.com']);
    return {business, actor, subject, issuer, epoch:authority.active_epoch, authorityId:authority.id};
  });
}

async function sessionFixture(db, owner, ageMinutes=0) {
  const session = randomUUID(), provider = randomUUID(), hash = randomBytes(32);
  await db.query("INSERT INTO auth.sessions(id,user_id,aal,created_at,updated_at) VALUES($1,$2,'aal2',clock_timestamp(),clock_timestamp())",
    [provider,owner.subject]);
  await db.query(`
    WITH observed AS MATERIALIZED (SELECT clock_timestamp()-interval '1 second'-($5*interval '1 minute') AS stamp)
    INSERT INTO crest_private.app_sessions(id,actor_id,provider_session_id,token_hash,issued_security_epoch,created_at,
      authenticated_at,last_active_at,expires_at,trusted,provider_token_ciphertext,key_id,created_by,updated_by)
    SELECT $1,id,$3,$4,current_security_epoch,stamp,stamp,stamp,stamp+interval '12 hours',false,$6,'synthetic',id,id
    FROM crest_private.actors CROSS JOIN observed WHERE id=$2
  `,[session,owner.actor,provider,hash,ageMinutes,randomBytes(32)]);
  return {provider, args:()=>[hash,session,owner.actor,owner.issuer,owner.subject,provider,new Date(Date.now()+120000),owner.business]};
}

async function claim(db, {business, actor, epoch}) {
  const operation = randomUUID();
  await db.query(`
    INSERT INTO crest_private.operations(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,created_by,origin)
    VALUES($1,$2,$3,'finance.account.save',1,$4,$5,$3,'manual')
  `, [business, operation, actor, epoch, 'a'.repeat(64)]);
  return operation;
}

async function insertAccount(db, {business, actor}, operation, id, account) {
  await db.query(`
    INSERT INTO crest.accounts(id,business_id,code,account_type,normal_side,control_kind,report_role,currency,operation_id,created_by,origin)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'manual')
  `, [id,business,account.code,account.accountType,account.normalSide,account.controlKind,account.reportRole,account.currency,operation,actor]);
}

function snapshot(id, account, version, name, active) {
  return {schemaVersion:1,id,...account,version:String(version),name,active};
}

async function appendRevision(db, {business, actor}, operation, before, after, auditAfter = after) {
  const audit = randomUUID();
  await db.query(`
    INSERT INTO crest.account_versions(business_id,account_id,version,name,active,reason,audit_event_id,created_by,operation_id,origin)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'manual')
  `, [business,after.id,after.version,after.name,after.active,auditReason,audit,actor,operation]);
  await db.query(`
    INSERT INTO crest_private.audit_events(id,business_id,operation_id,actor_id,entity_kind,entity_id,entity_version,action,reason,delta,created_by,origin)
    VALUES($1,$2,$3,$4,'accounts',$5,$6,$7,$8,$9,$4,'manual')
  `, [audit,business,operation,actor,after.id,after.version,before===null?'create':'revise',auditReason,
    {schemaVersion:1,before,after:auditAfter}]);
  await db.query(`
    UPDATE crest_private.operations SET state='committed',result_schema_version=1,result=$3
    WHERE business_id=$1 AND operation_id=$2
  `, [business,operation,{schemaVersion:1,accountId:after.id,version:after.version}]);
}

test('fictional finance accounts retain audited revisions and enforce scope in PostgreSQL', {timeout:240000}, async t => {
  const cluster = await recoveryCluster();
  let sandbox;
  try {
    sandbox = await migrationSandbox(cluster.testDatabaseUrl);
    const target = await sandbox.database(), db = await sandbox.connect(target);
    await sandbox.apply(target,await sandbox.prefix(0),true);
    await installProviderSchema(db,target);
    const previous=await sandbox.apply(target,await sandbox.prefix(70));
    assert.equal(previous.history.length,70);
    const owner = await businessFixture(db,'Fictional accounting business');
    const foreign = await businessFixture(db,'Fictional different business');

    await t.test('registered migration preserves populated schema70 and adds no accounts or mappings',async () => {
      await assert.rejects(requireSyntheticFinanceAccountConfiguration(target),{message:'SYNTHETIC_FINANCE_ACCOUNT_MIGRATION_REQUIRED'});
      const before=await inventory(db), adopted=await sandbox.apply(target);
      await requireSyntheticFinanceAccountConfiguration(target);
      assert.equal(adopted.history.length,71);
      assert.deepEqual(adopted.history.slice(0,70),previous.history);
      assert.deepEqual((await sandbox.apply(target)).history,adopted.history);
      const after=await inventory(db), newTables=after.filter(row=>!before.some(old=>old.schema===row.schema&&old.name===row.name));
      assert.deepEqual(newTables.map(row=>[row.schema+'.'+row.name,row.rows]),[
        ['crest.account_mapping_versions',0],['crest.account_versions',0],['crest.accounts',0],['crest_private.finance_controls',0]
      ]);
      assert.deepEqual(after.filter(row=>!newTables.includes(row)&&row.schema!=='supabase_migrations'),
        before.filter(row=>row.schema!=='supabase_migrations'));
    });
    const id = randomUUID();
    const first = snapshot(id,accountDefinition,1,'Fictional business bank',true);
    const archived = snapshot(id,accountDefinition,2,'=Fictional former bank',false);

    await t.test('save and archive preserve original account identity, exact name history and audit',async () => {
      await transaction(db,async () => {
        const operation = await claim(db,owner);
        await insertAccount(db,owner,operation,id,accountDefinition);
        await appendRevision(db,owner,operation,null,first);
      });
      await transaction(db,async () => {
        await appendRevision(db,owner,await claim(db,owner),first,archived);
      });
      const rows = (await db.query(`
        SELECT crest_private.finance_account_snapshot(a,v) AS snapshot, audit.delta
        FROM crest.accounts a JOIN crest.account_versions v ON (a.business_id,a.id)=(v.business_id,v.account_id)
        JOIN crest_private.audit_events audit ON (audit.business_id,audit.id)=(v.business_id,v.audit_event_id)
        WHERE a.id=$1 ORDER BY v.version
      `,[id])).rows;
      assert.deepEqual(rows,[
        {snapshot:first,delta:{schemaVersion:1,before:null,after:first}},
        {snapshot:archived,delta:{schemaVersion:1,before:first,after:archived}}
      ]);
    });

    await t.test('immutable identity, unique code, valid classifications and contiguous history hold',async () => {
      await assert.rejects(db.query("UPDATE crest.accounts SET code='2000' WHERE id=$1",[id]),{code:'55000'});
      await assert.rejects(db.query('DELETE FROM crest.account_versions WHERE account_id=$1',[id]),{code:'55000'});
      await assert.rejects(db.query('TRUNCATE crest.accounts,crest.account_versions,crest.account_mapping_versions'),{code:'55000'});
      await assert.rejects(transaction(db,async () => {
        await insertAccount(db,owner,await claim(db,owner),randomUUID(),accountDefinition);
      }),{code:'23505'});
      for(const account of [{...accountDefinition,normalSide:'credit'}, {...accountDefinition,reportRole:'owner_custody'}]){
        await assert.rejects(transaction(db,async () => {
          await insertAccount(db,owner,await claim(db,owner),randomUUID(),{...account,code:'1090'});
        }),{code:'23514'});
      }
      await assert.rejects(transaction(db,async () => {
        await appendRevision(db,owner,await claim(db,owner),archived,{...archived,version:'4'});
      }),{code:'23503'});
    });

    await t.test('missing first revision, false audit and foreign scope fail without a partial commit',async () => {
      await assert.rejects(transaction(db,async () => {
        const operation = await claim(db,owner), otherId = randomUUID();
        await insertAccount(db,owner,operation,otherId,{...accountDefinition,code:'1090'});
        // Provide a separate valid audit for this claim to prove the first-version FK,
        // not the generic operation guard, rejects the incomplete new account.
        await appendRevision(db,owner,operation,archived,{...archived,version:'3'});
      }),error=>error.code==='23503'&&error.constraint==='finance_account_first_version');
      await assert.rejects(transaction(db,async () => {
        const proposed = {...archived,version:'3',name:'Fictional revised name'};
        await appendRevision(db,owner,await claim(db,owner),archived,proposed,{...proposed,active:true});
      }),{code:'23514',message:'FINANCE_ACCOUNT_AUDIT_REQUIRED'});
      await assert.rejects(transaction(db,async () => {
        await appendRevision(db,foreign,await claim(db,foreign),archived,{...archived,version:'3'});
      }),{code:'23503'});
      const counts = (await db.query(`
        SELECT (SELECT count(*)::int FROM crest.accounts) AS accounts,
         (SELECT count(*)::int FROM crest.account_versions) AS revisions
      `)).rows[0];
      assert.deepEqual(counts,{accounts:1,revisions:2});
    });

    await t.test('ordinary app and export roles have no direct access even with a tenant setting',async () => {
      for(const role of ['crest_web','crest_export','crest_worker']){
        await assert.rejects(transaction(db,async () => {
          await db.query('SET LOCAL ROLE '+role);
          await db.query("SELECT set_config('crest.business_id',$1,true)",[owner.business]);
          await db.query('SELECT * FROM crest.accounts');
        }),{code:'42501'});
      }
      const result = (await db.query(`
        SELECT c.relname AS name,c.relrowsecurity AND c.relforcerowsecurity AS enforced
        FROM pg_class c WHERE c.oid IN ('crest.accounts'::regclass,'crest.account_versions'::regclass)
        ORDER BY c.relname
      `)).rows;
      assert.deepEqual(result,[{name:'account_versions',enforced:true},{name:'accounts',enforced:true}]);
    });

    await t.test('one account-source snapshot roundtrips exact CSV cells through a neutral database',async () => {
      const rows = await transaction(db,async () => {
        await db.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
        const results = {};
        for(const [table,exactNumbers] of [['accounts',"jsonb_build_object('first_version',t.first_version::text)"],
          ['account_versions',"jsonb_build_object('version',t.version::text,'previous_version',t.previous_version::text)"]]){
          const result = await db.query(`
            SELECT to_jsonb(t) || ${exactNumbers} ||
              jsonb_build_object('created_at',to_char(t.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')) AS source
            FROM crest.${table} t WHERE t.business_id=$1 ORDER BY t.id
          `,[owner.business]);
          results[table] = result.rows.map(row=>row.source);
        }
        return results;
      });
      const input = {businessId:owner.business,snapshotToken:'a'.repeat(64),rows,
        expectedCounts:{accounts:1,account_versions:2}};
      const artifact = formatFinanceAccountSource(input);
      const file = name=>artifact.files.find(part=>part.name===name).content;
      const map = JSON.parse(file('account_versions_escape_map.json'));
      assert.deepEqual(map.escapes.map(row=>row.column),['name']);
      assert.equal(JSON.parse(artifact.manifest).completePortableExport,false);

      const destination = await cluster.database(), neutral = await sandbox.connect(destination);
      await neutral.query('CREATE TABLE imported_finance_rows (source_table text, id uuid, row jsonb, PRIMARY KEY(source_table,id))');
      for(const table of ['accounts','account_versions']){
        const columns=financeAccountSourceColumns[table];
        const csv = file(table+'.csv'), escapes = JSON.parse(file(table+'_escape_map.json')).escapes;
        const restored = readSourceExportCsv(csv,escapes,{columns,maxRows:10,booleans:table==='account_versions'?['active']:[]});
        for(const row of restored)await neutral.query('INSERT INTO imported_finance_rows VALUES($1,$2,$3)',[table,row.id,row]);
        const actual = (await neutral.query('SELECT row FROM imported_finance_rows WHERE source_table=$1 ORDER BY id',[table])).rows.map(row=>row.row);
        assert.deepEqual(actual,rows[table]);
      }
      assert.throws(()=>formatFinanceAccountSource({...input,rows:{...rows,account_versions:rows.account_versions.filter(row=>row.version==='2')}}),
        /FINANCE_ACCOUNT_SOURCE_REVIEW_REQUIRED/);
    });

    await t.test('account configuration commands require a separate preview grant, recent owner authority and one locked version',async () => {
      const connection = await sandbox.connect(target), peer = await sandbox.connect(target), web = await sandbox.connect(target);
      await connection.query('SET ROLE crest_finance_preview');
      await peer.query('SET ROLE crest_finance_preview');
      await web.query('SET ROLE crest_web');
      const ownerSession = await sessionFixture(db,owner), peerSession = await sessionFixture(db,owner);
      const stale = await sessionFixture(db,owner,16), otherSession = await sessionFixture(db,foreign);
      const accountId = randomUUID(), operation = randomUUID();
      const {currency,...identity} = {...accountDefinition,code:'1090'};
      assert.equal(currency,'USD');
      const body = {identity,name:'Fictional separate account',active:true,reason:null};
      const query = async (client,sql,args)=>(await client.query(sql,args)).rows[0].value;
      const save = (client,session,key,version,body,epoch=owner.epoch) =>
        query(client,'SELECT crest_commands.save_finance_account($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,$12,$13) value',
          [...session.args(),epoch,key,accountId,version,body]);
      const lookup = (session,key,version='0',account=accountId) => query(connection,
        'SELECT crest_commands.lookup_finance_account_operation($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) value',
        [...session.args(),key,owner.epoch,account,version]);
      const retirementReason='Fictional account save was interrupted';
      const retire = (client,session,key,version,reason=retirementReason) => query(client,
        'SELECT crest_commands.retire_finance_account_save($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) value',
        [...session.args(),owner.epoch,key,owner.epoch,accountId,version,reason]);
      const history = (session,after) => query(connection,
        'SELECT crest_commands.read_finance_account_history($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1) value',
        [...session.args(),accountId,after]);
      const list = (session,after,includeArchived) => query(connection,
        'SELECT crest_commands.list_finance_accounts($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1) value',
        [...session.args(),after,includeArchived]);

      await assert.rejects(requireSyntheticFinanceAccountConfiguration(target,owner.business),{message:'SYNTHETIC_FINANCE_ACCOUNT_SETUP_REQUIRED'});
      const login='crest_finance_fixture_'+randomBytes(8).toString('hex'),secret=randomBytes(32).toString('hex');
      const restricted=new URL(target);restricted.username=login;restricted.password=secret;
      await sandbox.admin.query(`CREATE ROLE ${login} LOGIN NOINHERIT NOSUPERUSER NOCREATEROLE NOCREATEDB NOREPLICATION NOBYPASSRLS PASSWORD '${secret}'`);
      try{
        await assert.rejects(requireSyntheticFinancePreviewConnection(restricted.href,login),/SYNTHETIC_FINANCE_PREVIEW_REVIEW_REQUIRED/);
        await sandbox.admin.query('GRANT crest_finance_preview TO '+login);
        await requireSyntheticFinancePreviewConnection(restricted.href,login);
        await assert.rejects(requireSyntheticFinancePreviewConnection(restricted.href,'crest_web'),/SYNTHETIC_FINANCE_PREVIEW_REVIEW_REQUIRED/);
        await sandbox.admin.query('GRANT crest_web TO '+login);
        await assert.rejects(requireSyntheticFinancePreviewConnection(restricted.href,login),/SYNTHETIC_FINANCE_PREVIEW_REVIEW_REQUIRED/);
      }finally{await sandbox.admin.query('DROP ROLE '+login);}
      await assert.rejects(save(web,ownerSession,operation,'0',body),{code:'42501'});
      await assert.rejects(save(connection,ownerSession,operation,'0',body),{message:'FINANCE_ACCOUNT_SETUP_REQUIRED'});
      assert.deepEqual(await lookup(ownerSession,operation),{state:'absent'});
      await db.query(`
        INSERT INTO crest_private.finance_controls(business_id,recovery_authority_id,created_by,origin)
        VALUES($1,$2,$3,'system')
      `,[owner.business,owner.authorityId,owner.actor]);
      await requireSyntheticFinanceAccountConfiguration(target,owner.business);
      await assert.rejects(requireSyntheticFinanceAccountConfiguration(target,foreign.business),{message:'SYNTHETIC_FINANCE_ACCOUNT_SETUP_REQUIRED'});
      await assert.rejects(save(connection,stale,operation,'0',body),{code:'42501'});

      const [created,replayed] = await Promise.all([
        save(connection,ownerSession,operation,'0',body),save(peer,peerSession,operation,'0',body)
      ]);
      assert.equal(created.state,'committed');
      assert.deepEqual(replayed,created);
      assert.deepEqual(await lookup(ownerSession,operation),created);
      assert.deepEqual(await lookup(otherSession,operation),{state:'absent'});
      assert.deepEqual(await lookup(ownerSession,operation,'0',randomUUID()),{state:'conflict',reason:'operation'});
      assert.deepEqual(await retire(peer,peerSession,operation,'0'),created);
      assert.deepEqual((await history(otherSession,'0')).rows,[]);
      assert.deepEqual((await list(otherSession,null,true)).rows,[]);
      assert.deepEqual((await list(ownerSession,null,false)).rows.map(row=>row.id),[accountId]);
      assert.deepEqual(await save(connection,ownerSession,operation,'0',{...body,name:'Different request'}),
        {state:'conflict',reason:'operation'});

      const revise = {identity:null,name:'Fictional archived account',active:false,reason:'Account no longer used'};
      const [firstTry,secondTry] = await Promise.all([
        save(connection,ownerSession,randomUUID(),'1',revise),
        save(peer,peerSession,randomUUID(),'1',revise)
      ]);
      assert.deepEqual([firstTry.state,secondTry.state].sort(),['committed','conflict']);
      assert.deepEqual(firstTry.state==='conflict'?firstTry:secondTry,{state:'conflict',reason:'version',currentVersion:'2'});
      const initialPage = await history(ownerSession,'0'), archivedPage = await history(ownerSession,'1');
      assert.equal(initialPage.hasMore,true);
      assert.equal(initialPage.rows[0].name,body.name);
      assert.equal(archivedPage.hasMore,false);
      assert.deepEqual(archivedPage.rows[0],{
        ...snapshot(accountId,{...identity,currency:'USD'},2,revise.name,false),reason:revise.reason,
        auditEventId:(firstTry.state==='committed'?firstTry:secondTry).receipt.auditEventId,
      });
      const initialAccounts = await list(ownerSession,null,true);
      assert.equal(initialAccounts.hasMore,true);
      assert.deepEqual(initialAccounts.rows,[archived]);
      const laterAccounts = await list(ownerSession,initialAccounts.rows[0].code,true);
      assert.equal(laterAccounts.hasMore,false);
      assert.equal(laterAccounts.rows[0].id,accountId);
      assert.equal(laterAccounts.rows[0].active,false);
      assert.deepEqual((await list(ownerSession,null,false)).rows,[]);

      const abandoned=randomUUID();
      await assert.rejects(retire(web,ownerSession,abandoned,'2'),{code:'42501'});
      await assert.rejects(retire(connection,stale,abandoned,'2'),{code:'42501'});
      assert.deepEqual(await lookup(ownerSession,abandoned,'2'),{state:'absent'});
      await connection.query('BEGIN');
      let retirement, late;
      try {
        retirement=await retire(connection,ownerSession,abandoned,'2');
        assert.equal(retirement.state,'retired');
        assert.equal(retirement.receipt.expectedVersion,'2');
        late=save(peer,peerSession,abandoned,'2',revise);
        await connection.query('COMMIT');
      } catch(error) {
        await connection.query('ROLLBACK');
        await late?.catch(()=>{});
        throw error;
      }
      assert.deepEqual(await late,{state:'conflict',reason:'operation'});
      assert.deepEqual(await lookup(ownerSession,abandoned,'2'),retirement);
      assert.deepEqual(await lookup(otherSession,abandoned,'2'),{state:'absent'});
      assert.deepEqual(await lookup(ownerSession,abandoned,'1'),{state:'conflict',reason:'operation'});
      assert.deepEqual(await retire(peer,peerSession,abandoned,'2'),retirement);
      assert.deepEqual(await retire(peer,peerSession,abandoned,'2','Different decision'),{state:'conflict',reason:'operation'});
      assert.equal((await history(ownerSession,'1')).rows[0].version,'2');
      assert.deepEqual((await db.query(`
        SELECT o.command_type,a.reason,a.action FROM crest_private.operations o JOIN crest_private.audit_events a
        USING(business_id,operation_id,actor_id) WHERE o.business_id=$1 AND o.operation_id=$2
      `,[owner.business,abandoned])).rows,[{command_type:'finance.account.retire',reason:retirementReason,action:'retire'}]);
      await assert.rejects(save(connection,ownerSession,randomUUID(),'2',revise,randomUUID()),{message:'RECOVERY_REVIEW_REQUIRED'});
      await db.query('UPDATE crest_private.business_recovery_authorities SET writes_enabled=false,version=version+1 WHERE business_id=$1',[owner.business]);
      await assert.rejects(save(connection,ownerSession,randomUUID(),'2',revise),{message:'RECOVERY_REVIEW_REQUIRED'});
      await assert.rejects(retire(connection,ownerSession,randomUUID(),'2'),{message:'RECOVERY_REVIEW_REQUIRED'});
      assert.equal((await history(ownerSession,'1')).rows[0].version,'2');
      await db.query('DELETE FROM auth.sessions WHERE id=$1',[ownerSession.provider]);
      await assert.rejects(history(ownerSession,'0'),{code:'42501'});
    });

    let approvedMappings;
    await t.test('fixed account mapping approval and effective-date resolution require an exact active account',async () => {
      await db.query('UPDATE crest_private.business_recovery_authorities SET writes_enabled=true,version=version+1 WHERE business_id=$1',[owner.business]);
      const allowed=await sandbox.connect(target), peer=await sandbox.connect(target), web=await sandbox.connect(target);
      await allowed.query('SET ROLE crest_finance_preview');
      await peer.query('SET ROLE crest_finance_preview');
      await web.query('SET ROLE crest_web');
      const ownerSession=await sessionFixture(db,owner), peerSession=await sessionFixture(db,owner);
      const stale=await sessionFixture(db,owner,16), foreignSession=await sessionFixture(db,foreign);
      const revenue=randomUUID(), tips=randomUUID();
      const query=async (client,sql,args)=>(await client.query(sql,args)).rows[0].value;
      const save=(id,version,body)=>query(allowed,
        'SELECT crest_commands.save_finance_account($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,$12,$13) value',
        [...ownerSession.args(),owner.epoch,randomUUID(),id,version,body]);
      const approve=(client,session,operation,purpose,version,account,date,reason='Fictional owner approval')=>query(client,
        'SELECT crest_commands.approve_fixed_finance_mapping($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) value',
        [...session.args(),owner.epoch,operation,purpose,version,account,date,reason]);
      const resolve=(session,purpose,date,client=allowed)=>query(client,
        'SELECT crest_commands.resolve_fixed_finance_mapping($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) value',
        [...session.args(),purpose,date]);
      const mappingHistory=(session,purpose,before=null,client=allowed)=>query(client,
        'SELECT crest_commands.read_fixed_finance_mapping_history($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1) value',
        [...session.args(),purpose,before]);
      const editor=(session,purpose,client=allowed)=>query(client,
        'SELECT crest_commands.fixed_finance_mapping_editor($1,$2,$3,$4,$5,$6,$7,$8,$9) value',
        [...session.args(),purpose]);
      const lookupMapping=(session,key,purpose,version,originalEpoch=owner.epoch)=>query(allowed,
        'SELECT crest_commands.lookup_fixed_finance_mapping_operation($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) value',
        [...session.args(),key,originalEpoch,purpose,version]);
      const retireMapping=(client,session,key,purpose,version,reason='Fictional interrupted mapping',originalEpoch=owner.epoch)=>query(client,
        'SELECT crest_commands.retire_fixed_finance_mapping_approval($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) value',
        [...session.args(),owner.epoch,key,originalEpoch,purpose,version,reason]);
      for(const [id,code,name] of [[revenue,'4000','Fictional service revenue'],[tips,'4100','Fictional tip revenue']]){
        assert.equal((await save(id,'0',{identity:{code,accountType:'revenue',normalSide:'credit',controlKind:null,reportRole:'revenue'},
          name,active:true,reason:null})).state,'committed');
      }
      const operation=randomUUID();
      assert.deepEqual(await editor(ownerSession,'service_revenue'),{
        schemaVersion:1,businessId:owner.business,purpose:'service_revenue',latest:null,
        eligible:{id:revenue,code:'4000',name:'Fictional service revenue'}
      });
      assert.deepEqual(await editor(foreignSession,'service_revenue'),{
        schemaVersion:1,businessId:foreign.business,purpose:'service_revenue',latest:null,eligible:null
      });
      await assert.rejects(editor(ownerSession,'service_revenue',web),{code:'42501'});
      await assert.rejects(approve(web,ownerSession,operation,'service_revenue','0',revenue,'2026-01-01'),{code:'42501'});
      await assert.rejects(approve(allowed,stale,operation,'service_revenue','0',revenue,'2026-01-01'),{code:'42501'});
      await assert.rejects(approve(allowed,ownerSession,operation,'service_revenue','0',tips,'2026-01-01'),{message:'FINANCE_MAPPING_ACCOUNT_REQUIRED'});
      await assert.rejects(approve(allowed,ownerSession,operation,'service_revenue','0',randomUUID(),'2026-01-01'),{message:'FINANCE_MAPPING_ACCOUNT_REQUIRED'});
      await assert.rejects(resolve(ownerSession,'service_revenue','2026-01-01'),{message:'MAPPING_NOT_READY'});
      const [first,replay]=await Promise.all([
        approve(allowed,ownerSession,operation,'service_revenue','0',revenue,'2026-01-01','=Fictional mapping approval'),
        approve(peer,peerSession,operation,'service_revenue','0',revenue,'2026-01-01','=Fictional mapping approval'),
      ]);
      assert.equal(first.state,'committed');
      assert.deepEqual(replay,first);
      assert.deepEqual(await lookupMapping(ownerSession,operation,'service_revenue','0'),first);
      assert.deepEqual(await lookupMapping(ownerSession,operation,'service_revenue','1'),{state:'conflict',reason:'operation'});
      assert.deepEqual(await retireMapping(peer,peerSession,operation,'service_revenue','0'),first);
      assert.deepEqual(await approve(allowed,ownerSession,operation,'service_revenue','0',revenue,'2026-01-01'),
        {state:'conflict',reason:'operation'});
      await assert.rejects(approve(allowed,ownerSession,randomUUID(),'service_revenue','1',revenue,'2026-01-01'),
        {message:'FINANCE_MAPPING_EFFECTIVE_ORDER_REQUIRED'});
      await assert.rejects(approve(allowed,ownerSession,randomUUID(),'service_revenue','0',revenue,'2026-04-01'),
        {message:'FINANCE_MAPPING_VERSION_CONFLICT'});
      const competing=await Promise.allSettled([
        approve(allowed,ownerSession,randomUUID(),'service_revenue','1',revenue,'2026-04-01'),
        approve(peer,peerSession,randomUUID(),'service_revenue','1',revenue,'2026-04-01'),
      ]);
      assert.deepEqual(competing.map(result=>result.status).sort(),['fulfilled','rejected']);
      assert.equal(competing.find(result=>result.status==='rejected').reason.message,'FINANCE_MAPPING_VERSION_CONFLICT');
      const second=competing.find(result=>result.status==='fulfilled').value;
      const interrupted=randomUUID();
      await assert.rejects(retireMapping(web,ownerSession,interrupted,'service_revenue','2'),{code:'42501'});
      await assert.rejects(retireMapping(allowed,stale,interrupted,'service_revenue','2'),{code:'42501'});
      assert.deepEqual(await lookupMapping(ownerSession,interrupted,'service_revenue','2'),{state:'absent'});
      let retired, late;
      await allowed.query('BEGIN');
      try{
        retired=await retireMapping(allowed,ownerSession,interrupted,'service_revenue','2');
        late=approve(peer,peerSession,interrupted,'service_revenue','2',revenue,'2026-05-01');
        await allowed.query('COMMIT');
      }catch(error){
        await allowed.query('ROLLBACK');
        await late?.catch(()=>{});
        throw error;
      }
      assert.equal(retired.state,'retired');
      assert.equal(retired.receipt.expectedVersion,'2');
      assert.deepEqual(await late,{state:'conflict',reason:'operation'});
      assert.deepEqual(await lookupMapping(ownerSession,interrupted,'service_revenue','2'),retired);
      assert.deepEqual(await lookupMapping(foreignSession,interrupted,'service_revenue','2'),{state:'absent'});
      assert.deepEqual(await lookupMapping(ownerSession,interrupted,'tips_revenue','2'),{state:'conflict',reason:'operation'});
      assert.deepEqual(await retireMapping(peer,peerSession,interrupted,'service_revenue','2'),retired);
      assert.deepEqual(await retireMapping(peer,peerSession,interrupted,'service_revenue','2','Different reason'),
        {state:'conflict',reason:'operation'});
      const third=await approve(allowed,ownerSession,randomUUID(),'tips_revenue','0',tips,'2026-01-01');
      assert.equal((await resolve(ownerSession,'service_revenue','2026-03-31')).id,first.receipt.id);
      assert.equal((await resolve(ownerSession,'service_revenue','2026-03-31')).effectiveUntil,'2026-04-01');
      const boundary=await resolve(ownerSession,'service_revenue','2026-04-01');
      assert.equal(boundary.id,second.receipt.id);
      assert.equal(boundary.effectiveUntil,null);
      assert.equal(boundary.accountCode,'4000');
      assert.equal((await resolve(ownerSession,'tips_revenue','2026-04-01')).accountId,tips);
      await assert.rejects(resolve(ownerSession,'service_revenue','2025-12-31'),{message:'MAPPING_NOT_READY'});
      await assert.rejects(resolve(foreignSession,'service_revenue','2026-04-01'),{message:'MAPPING_NOT_READY'});
      await assert.rejects(resolve(ownerSession,'service_revenue','2026-04-01',web),{code:'42501'});
      await assert.rejects(web.query('SELECT * FROM crest.account_mapping_versions'),{code:'42501'});
      await assert.rejects(db.query('UPDATE crest.account_mapping_versions SET effective_from=current_date'),{code:'55000'});
      await assert.rejects(save(tips,'1',{identity:null,name:'Fictional archived tip revenue',active:false,
        reason:'Fictional availability review'}),{message:'FINANCE_MAPPING_ACCOUNT_STILL_ASSIGNED'});
      await assert.rejects(approve(allowed,ownerSession,randomUUID(),'cash','0',null,'2026-04-01'),
        {message:'FINANCE_MAPPING_CLOSURE_REQUIRED'});
      const closed=await approve(allowed,ownerSession,randomUUID(),'tips_revenue','1',null,'2026-04-01','Fictional mapping closed');
      assert.equal(closed.receipt.accountId,null);
      const future=await approve(allowed,ownerSession,randomUUID(),'service_revenue','2',null,'9999-12-31','Fictional scheduled closure');
      approvedMappings=[first.receipt,second.receipt,future.receipt,third.receipt,closed.receipt];
      await assert.rejects(save(revenue,'1',{identity:null,name:'Fictional archived service revenue',active:false,
        reason:'Fictional availability review'}),{message:'FINANCE_MAPPING_ACCOUNT_STILL_ASSIGNED'});
      assert.equal((await resolve(ownerSession,'service_revenue','9999-12-30')).effectiveUntil,'9999-12-31');
      await assert.rejects(resolve(ownerSession,'service_revenue','9999-12-31'),{message:'MAPPING_NOT_READY'});
      assert.equal((await resolve(ownerSession,'tips_revenue','2026-03-31')).id,third.receipt.id);
      await assert.rejects(resolve(ownerSession,'tips_revenue','2026-04-01'),{message:'MAPPING_NOT_READY'});
      assert.equal((await save(tips,'1',{identity:null,name:'Fictional archived tip revenue',active:false,
        reason:'Fictional availability review'})).state,'committed');
      await assert.rejects(resolve(ownerSession,'tips_revenue','2026-03-31'),{message:'MAPPING_NOT_READY'});
      await assert.rejects(resolve(ownerSession,'tips_revenue','2026-04-01'),{message:'MAPPING_NOT_READY'});
      await assert.rejects(approve(allowed,ownerSession,randomUUID(),'tips_revenue','2',tips,'2026-05-01'),
        {message:'FINANCE_MAPPING_ACCOUNT_REQUIRED'});
      const latest=await mappingHistory(ownerSession,'tips_revenue');
      assert.equal(latest.hasMore,true);
      assert.deepEqual(latest.rows,[{...closed.receipt,accountCode:null}]);
      assert.deepEqual(await mappingHistory(ownerSession,'tips_revenue',latest.rows[0].version),{
        schemaVersion:1,businessId:owner.business,purpose:'tips_revenue',hasMore:false,rows:[{...third.receipt,accountCode:'4100'}]
      });
      assert.deepEqual((await mappingHistory(foreignSession,'tips_revenue')).rows,[]);
      await assert.rejects(mappingHistory(ownerSession,'tips_revenue',null,web),{code:'42501'});
      assert.deepEqual(await editor(ownerSession,'tips_revenue'),{
        schemaVersion:1,businessId:owner.business,purpose:'tips_revenue',
        latest:{version:'2',accountId:null,effectiveFrom:'2026-04-01'},eligible:null
      });
      assert.equal((await db.query('SELECT count(*)::integer n FROM crest.account_mapping_versions')).rows[0].n,5);
    });

    await t.test('encrypted schema71 recovery preserves history and refuses the schema70 profile',async () => {
      const workspace = await privateWorkspace(), point = join(workspace,'point');
      let keys, destinationCluster, restored;
      try {
        await mkdir(point,{mode:0o700});
        keys = await keyPair(workspace);
        await assert.rejects(backupLegacy70Database(db,target,point,keys.recipient),/SYNTHETIC_RECOVERY_BACKUP_FAILED:coverage/);
        const {manifest} = await backupDatabase(db,target,point,keys.recipient);
        assert.equal(manifest.schemaVersion,71);
        assert.equal(manifest.rows.find(row=>row.name==='accounts').rows,4);
        assert.equal(manifest.rows.find(row=>row.name==='account_versions').rows,7);
        assert.equal(manifest.rows.find(row=>row.name==='account_mapping_versions').rows,5);
        assert.equal(manifest.rows.find(row=>row.name==='finance_controls').rows,1);
        destinationCluster = await recoveryCluster();
        const destination = await destinationCluster.database();
        assert.notEqual(new URL(target).port,new URL(destination).port);
        await assert.rejects(restoreLegacy70Database(point,keys.path,destination),/SYNTHETIC_RECOVERY_RESTORE_FAILED:manifest/);
        await restoreDatabase(point,keys.path,destination);
        restored = await connect(destination);
        assert.deepEqual(await inventory(restored),manifest.rows);
        const restoredMappings=(await restored.query(`
          SELECT crest_private.finance_mapping_snapshot(m) AS mapping FROM crest.account_mapping_versions m
          ORDER BY purpose,version
        `)).rows.map(row=>row.mapping);
        assert.deepEqual(restoredMappings,approvedMappings);
        const sources=await transaction(restored,async()=>{
          await restored.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
          const entries=Object.keys(financeAccountSourceColumns);
          const groups={};
          for(const table of entries){
            const numbers=table==='accounts'?"jsonb_build_object('first_version',t.first_version::text)":
              "jsonb_build_object('version',t.version::text,'previous_version',t.previous_version::text)";
            const result=await restored.query(`
              SELECT to_jsonb(t) || ${numbers} ||
                jsonb_build_object('created_at',to_char(t.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')) source
              FROM crest.${table} t WHERE t.business_id=$1 ORDER BY t.id
            `,[owner.business]);
            groups[table]=result.rows.map(row=>row.source);
          }
          return groups;
        });
        const exportInput={businessId:owner.business,snapshotToken:'a'.repeat(64),
          rows:{accounts:sources.accounts,account_versions:sources.account_versions},
          expectedCounts:{accounts:4,account_versions:7},
          mappingSnapshot:{rows:sources.account_mapping_versions,expectedCount:5}};
        const portable=formatFinanceAccountSource(exportInput);
        const part=name=>portable.files.find(file=>file.name===name).content;
        assert.equal(JSON.parse(portable.manifest).schemaVersion,2);
        const escapes=JSON.parse(part('account_mapping_versions_escape_map.json')).escapes;
        assert.deepEqual(escapes.map(row=>row.column),['reason']);
        const imported=readSourceExportCsv(part('account_mapping_versions.csv'),escapes,
          {columns:financeAccountSourceColumns.account_mapping_versions,maxRows:10,booleans:[]});
        const neutral=await sandbox.connect(await cluster.database());
        await neutral.query('CREATE TABLE imported_finance_mappings (id uuid PRIMARY KEY, source jsonb NOT NULL)');
        for(const row of imported)await neutral.query('INSERT INTO imported_finance_mappings VALUES($1,$2)',[row.id,row]);
        assert.deepEqual((await neutral.query('SELECT source FROM imported_finance_mappings ORDER BY id')).rows.map(row=>row.source),
          sources.account_mapping_versions);
        assert.throws(()=>formatFinanceAccountSource({...exportInput,mappingSnapshot:{rows:sources.account_mapping_versions.filter(row=>row.id!==approvedMappings[0].id),expectedCount:4}}),
          /FINANCE_ACCOUNT_SOURCE_REVIEW_REQUIRED/);
        const history = (await restored.query(`
          SELECT v.version::text AS version,v.active,audit.delta
          FROM crest.account_versions v JOIN crest_private.audit_events audit
          ON (audit.business_id,audit.id)=(v.business_id,v.audit_event_id)
          WHERE v.account_id=$1 ORDER BY v.version
        `,[id])).rows;
        assert.deepEqual(history,[
          {version:'1',active:true,delta:{schemaVersion:1,before:null,after:first}},
          {version:'2',active:false,delta:{schemaVersion:1,before:first,after:archived}},
        ]);
        const visibility = (await restored.query(`
          SELECT has_function_privilege('crest_web',p.oid,'EXECUTE') AS web,
           has_function_privilege('crest_finance_preview',p.oid,'EXECUTE') AS preview
          FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
          WHERE n.nspname='crest_commands' AND p.proname IN ('save_finance_account','retire_finance_account_save')
          ORDER BY p.proname
        `)).rows;
        assert.deepEqual(visibility,[{web:false,preview:true},{web:false,preview:true}]);
        const retainedRetirement=(await restored.query(`
          SELECT a.reason,a.action,o.result->>'state' AS state FROM crest_private.operations o
          JOIN crest_private.audit_events a USING(business_id,operation_id,actor_id)
          WHERE o.command_type='finance.account.retire'
        `)).rows;
        assert.deepEqual(retainedRetirement,[{reason:'Fictional account save was interrupted',action:'retire',state:'retired'}]);
        await restored.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
        try {
          await restored.query('SET LOCAL ROLE crest_export');
          const context=(await restored.query('SELECT crest_commands.business_history_export_context($1) AS context',
            [owner.business])).rows[0].context;
          const projected=async kind=>(await restored.query(`
            SELECT canonical_evidence FROM crest_commands.business_history_export_page($1,$2,$3,NULL,20)
          `,[owner.business,context.snapshotToken,kind])).rows.map(row=>JSON.parse(row.canonical_evidence).row);
          const operation=(await projected('operation')).find(row=>row.command_type==='finance.account.retire');
          const audit=(await projected('audit_event')).find(row=>row.operation_id===operation?.operation_id);
          assert.equal(JSON.parse(operation.result).state,'retired');
          assert.equal(audit.action,'retire');
          assert.equal(audit.reason,'Fictional account save was interrupted');
          assert.deepEqual(JSON.parse(audit.delta).after,JSON.parse(operation.result));
          const mappingRetirement=(await projected('operation')).find(row=>row.command_type==='finance.mapping.retire');
          const mappingAudit=(await projected('audit_event')).find(row=>row.operation_id===mappingRetirement?.operation_id);
          assert.equal(mappingAudit.reason,'Fictional interrupted mapping');
          assert.equal(JSON.parse(mappingRetirement.result).receipt.purpose,'service_revenue');
          assert.deepEqual(JSON.parse(mappingAudit.delta).after,JSON.parse(mappingRetirement.result));
        } finally {
          await restored.query('ROLLBACK');
        }
        await assert.rejects(restored.query("UPDATE crest.accounts SET code='2000' WHERE id=$1",[id]),{code:'55000'});
      } finally {
        try { await restored?.end(); await destinationCluster?.close(); }
        finally {
          if(keys)await rm(keys.path,{force:true});
          for(const filename of ['receipt.json','database.age','manifest.age'])await rm(join(point,filename),{force:true});
          await rmdir(point);
          await rmdir(workspace);
        }
      }
    });

  } finally {
    try { await sandbox?.close(); } finally { await cluster.close(); }
  }
});
