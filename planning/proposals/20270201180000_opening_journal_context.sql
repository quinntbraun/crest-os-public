-- Held migration after registered138. Authenticated, fenced source resolution
-- for P27 preparation, not approval/posting or schema139 adoption. Caller owns
-- one READ COMMITTED transaction and its shared business/finance locks. The
-- established mutation-authority fence deliberately rejects stale RR authority.
SET LOCAL ROLE crest_schema_owner;
CREATE FUNCTION crest_commands.review_fictional_opening_journal_context(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,
 expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,expected_epoch uuid,
 expected_worksheet_revision bigint,expected_receivables_revision bigint
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
 SET search_path=pg_catalog,pg_temp SET row_security=on AS $review$
DECLARE worksheet crest.opening_worksheet_revisions;
 schedule crest.opening_receivable_schedule_revisions;
 authority jsonb; accounts jsonb; mappings jsonb; result jsonb;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF current_setting('transaction_isolation')<>'read committed' THEN
  RAISE EXCEPTION USING ERRCODE='25001',MESSAGE='OPENING_CONTEXT_FRESH_READ_REQUIRED';
 END IF;
 PERFORM crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'finance.post',true);
 IF expected_worksheet_revision IS NULL OR expected_worksheet_revision<1
  OR expected_receivables_revision IS NULL OR expected_receivables_revision<0 THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='OPENING_CONTEXT_INPUT_REQUIRED';
 END IF;
 authority:=crest_commands.read_authorized_business_context($1,$2,$3,$4,$5,$6,$7,$8);
 PERFORM set_config('crest.business_id',requested_business::text,true),set_config('crest.actor_id',expected_actor::text,true);
 PERFORM f.id FROM crest_private.finance_controls f WHERE f.business_id=requested_business FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='FINANCE_NOT_READY'; END IF;

 SELECT * INTO worksheet FROM crest.opening_worksheet_revisions w
  WHERE w.business_id=requested_business ORDER BY w.revision DESC LIMIT 1;
 IF worksheet.revision IS DISTINCT FROM expected_worksheet_revision THEN
  RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='OPENING_WORKSHEET_REVISION_CONFLICT';
 END IF;
 IF worksheet.time_zone IS DISTINCT FROM authority->>'timezone'
  OR worksheet.cutover_at AT TIME ZONE worksheet.time_zone IS DISTINCT FROM worksheet.cutover_on::timestamp THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='OPENING_BOUNDARY_CONTEXT_CHANGED';
 END IF;
 SELECT * INTO schedule FROM crest.opening_receivable_schedule_revisions s
  WHERE (s.business_id,s.worksheet_revision_id)=(requested_business,worksheet.id)
  ORDER BY s.revision DESC LIMIT 1;
 IF coalesce(schedule.revision,0) IS DISTINCT FROM expected_receivables_revision THEN
  RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='OPENING_RECEIVABLES_REVISION_CONFLICT';
 END IF;
 IF (SELECT count(*) FROM crest_private.opening_worksheet_banks(requested_business,worksheet.cutover_on))
   <>jsonb_array_length(worksheet.evidence->'banks') OR EXISTS(
  SELECT FROM jsonb_array_elements(worksheet.evidence->'banks') saved
  WHERE NOT EXISTS(SELECT FROM crest_private.opening_worksheet_banks(requested_business,worksheet.cutover_on) actual
   WHERE (actual.channel_id::text,actual.channel_version::text,actual.channel_version_id::text,actual.account_id::text,actual.account_code)
    =(saved->>'channelId',saved->>'channelVersion',saved->>'channelVersionId',saved->>'accountId',saved->>'accountCode'))
 ) THEN RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='OPENING_BANK_INVENTORY_CHANGED'; END IF;

 IF (SELECT count(*) FROM crest.accounts a WHERE a.business_id=requested_business
  AND (a.account_type IN ('asset','liability') OR a.code='3000'))>2048 THEN
  RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='OPENING_CONTEXT_CAPACITY_REQUIRED';
 END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('schemaVersion',1,'id',a.id,'currency',a.currency,
  'version',v.version::text,'name',v.name,'active',v.active,'code',a.code,'accountType',a.account_type,
  'normalSide',a.normal_side,'controlKind',a.control_kind,'reportRole',a.report_role)
  ORDER BY a.code COLLATE "C",a.id),'[]') INTO accounts
 FROM crest.accounts a JOIN LATERAL(SELECT av.version,av.name,av.active FROM crest.account_versions av
  WHERE (av.business_id,av.account_id)=(a.business_id,a.id) ORDER BY av.version DESC LIMIT 1) v ON true
 WHERE a.business_id=requested_business AND (a.account_type IN ('asset','liability') OR a.code='3000');
 -- Retain disabled/missing mappings and inactive accounts explicitly. They
 -- cannot silently disappear from the inventory or become verified zero.
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',m.id,'purpose',m.purpose,'version',m.version::text,
  'accountId',m.account_id,'effectiveFrom',to_char(m.effective_from,'YYYY-MM-DD'))
  ORDER BY m.purpose COLLATE "C"),'[]') INTO mappings FROM(
  SELECT DISTINCT ON (mv.purpose) mv.* FROM crest.account_mapping_versions mv
   WHERE mv.business_id=requested_business AND mv.effective_from<=worksheet.cutover_on
   ORDER BY mv.purpose,mv.effective_from DESC,mv.version DESC
 ) m;
 result:=jsonb_build_object('profile','crest.opening-journal-context-candidate.v1','catalogRegistered',false,
  'businessId',requested_business,'recoveryEpoch',expected_epoch,'consistency','finance_fenced_read_committed',
  'capturedAt',to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'worksheetRevisionId',worksheet.id,'worksheetRevision',worksheet.revision::text,
  'worksheetEvidenceSha256',worksheet.evidence_sha256,'worksheet',crest_private.opening_worksheet_receipt(worksheet),
  'cutoverOn',to_char(worksheet.cutover_on,'YYYY-MM-DD'),
  'cutoverAt',to_char(worksheet.cutover_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'timeZone',worksheet.time_zone,'receivables',CASE WHEN schedule.id IS NOT NULL THEN crest_private.opening_ar_receipt(schedule) END,
  'accounts',accounts,'mappings',mappings,
  'financialEventCount',(SELECT count(*)::text FROM crest.financial_events e WHERE e.business_id=requested_business),
  'financeCommitSequence',(SELECT coalesce(max(g.commit_sequence),0)::text FROM crest.atomic_finance_groups g WHERE g.business_id=requested_business),
  'posted',false,'approvalRecorded',false,'postingAuthorized',false,'fullSourceClosureVerified',false);
 IF octet_length(result::text)>8388608 THEN
  RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='OPENING_CONTEXT_CAPACITY_REQUIRED';
 END IF;
 RETURN result;
END $review$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_finance_account_owner;
ALTER FUNCTION crest_commands.review_fictional_opening_journal_context(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,bigint,bigint)
 OWNER TO crest_finance_account_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_finance_account_owner;
REVOKE ALL ON FUNCTION crest_commands.review_fictional_opening_journal_context(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,bigint,bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.review_fictional_opening_journal_context(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,bigint,bigint)
 TO crest_finance_preview;
