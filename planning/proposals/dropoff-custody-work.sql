-- Held schema66 extension. A handoff and an explicit start are separate events.
-- Use the existing work intervals, operator occupancy, and original-save receipts.
DO $review$
BEGIN
 IF EXISTS(SELECT 1 FROM (VALUES
  ('crest_private.valid_field_session_body(jsonb)','crest_schema_owner',false,'i','0f67989eafedf35f150dc1d81804e98bb4629c50d6852ef0fe35a69250767ca6'),
  ('crest_private.check_field_session_graph(uuid,uuid,uuid)','crest_booking_integrity_owner',true,'v','12123eda2a3e6f7edeee94995d4fb9b9f006d8b12fb1cb1d3e0e614a19488c43'),
  ('crest_private.field_session_result(uuid,uuid,uuid)','crest_booking_integrity_owner',true,'s','d1c52d2bf3d8e4011a48bb72590caa1873162a3cabbda8f4a5d6c2ae07330081'),
  ('crest_commands.change_field_session(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,bigint,jsonb)','crest_booking_owner',true,'v','da5b9cee0b3ebdf8829947ee56feab5dbb51eba61815af39d4d6bea468c7817f'),
  ('crest_private.original_operation_reference_valid(jsonb)','crest_schema_owner',false,'i','cd7545acc7b8f1fd277aee8cbd4a137c8b0aeba551914e97639e20baf50a9950')
 ) expected(signature,owner,definer,volatility,body_hash) WHERE NOT EXISTS(
  SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid=p.prolang WHERE p.oid=to_regprocedure(expected.signature)
   AND p.proowner=expected.owner::regrole AND p.prosecdef=expected.definer AND p.provolatile::text=expected.volatility
   AND NOT p.proleakproof AND l.lanname='plpgsql' AND p.proconfig=CASE WHEN expected.definer
    THEN ARRAY['search_path=pg_catalog, pg_temp','row_security=on'] ELSE ARRAY['search_path=pg_catalog, pg_temp'] END
   AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')=expected.body_hash
   AND NOT EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee=0)
 )) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_DROPOFF_WORK_SOURCE_REVIEW_REQUIRED';END IF;
END $review$;

CREATE FUNCTION crest_private.dropoff_work_ready(business uuid,job uuid,stamp timestamptz)
 RETURNS boolean LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp SET row_security=on AS $ready$
 SELECT EXISTS(SELECT 1 FROM crest.job_vehicles v WHERE v.business_id=business AND v.job_id=job)
  AND NOT EXISTS(
   SELECT 1 FROM crest.job_vehicles v WHERE v.business_id=business AND v.job_id=job AND NOT EXISTS(
    SELECT 1 FROM crest.custody_cases c JOIN crest.custody_events e
     ON (e.business_id,e.case_id,e.id,e.version)=(c.business_id,c.id,c.current_event_id,c.version)
    WHERE (c.business_id,c.job_id,c.job_vehicle_id,c.vehicle_id)=(v.business_id,v.job_id,v.id,v.vehicle_id)
     AND c.mode='dropoff' AND c.state='held' AND e.action='received' AND e.effective_at<=stamp
   )
  )
$ready$;
ALTER FUNCTION crest_private.dropoff_work_ready(uuid,uuid,timestamptz) OWNER TO crest_schema_owner;
REVOKE ALL ON FUNCTION crest_private.dropoff_work_ready(uuid,uuid,timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.dropoff_work_ready(uuid,uuid,timestamptz) TO crest_booking_owner,crest_booking_integrity_owner;

DO $extend$
DECLARE source text; definition text;
 action_list constant text:=$text$'depart','arrive','direct_arrive','pause','resume'$text$;
 start_actions constant text:=$text$action IN('direct_arrive','arrive')$text$;
 field_state constant text:=$text$   IF j.fulfillment_mode<>'mobile' OR NOT(action IN('depart','direct_arrive') AND j.state='scheduled' AND j.first_work_at IS NULL OR action='arrive' AND j.state='en_route' AND j.first_work_at IS NULL OR action='pause' AND j.state='in_progress' OR action='resume' AND j.state='paused') THEN RAISE EXCEPTION USING ERRCODE='P1801',MESSAGE='state';END IF;$text$;
 field_stamp constant text:=$text$   stamp:=clock_timestamp();before_job:=crest_private.jobs_projection(j);$text$;
BEGIN
 source:=pg_get_functiondef('crest_private.valid_field_session_body(jsonb)'::regprocedure);
 definition:=replace(replace(source,action_list,action_list||$text$,'start_dropoff'$text$),
  $text$'depart','arrive','resume'$text$,$text$'depart','arrive','resume','start_dropoff'$text$);
 EXECUTE definition;

 source:=pg_get_functiondef('crest_private.check_field_session_graph(uuid,uuid,uuid)'::regprocedure);
 definition:=replace(source,
  $text$  OR j.fulfillment_mode<>'mobile' OR j.state NOT IN('en_route','in_progress','paused')$text$,
  $text$  OR NOT(j.fulfillment_mode='mobile' AND action IN('depart','arrive','direct_arrive','pause','resume')
     OR j.fulfillment_mode='dropoff' AND action IN('start_dropoff','pause','resume'))
  OR j.state NOT IN('en_route','in_progress','paused')$text$);
 definition:=replace(definition,start_actions,$text$action IN('direct_arrive','arrive','start_dropoff')$text$);
 definition:=replace(definition,$text$  THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_FIELD_START_GRAPH_REQUIRED';END IF;$text$,
  $text$   OR action='start_dropoff' AND NOT crest_private.dropoff_work_ready(business,job,e.effective_at)
  THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_FIELD_START_GRAPH_REQUIRED';END IF;$text$);
 EXECUTE definition;

 source:=pg_get_functiondef('crest_private.field_session_result(uuid,uuid,uuid)'::regprocedure);
 EXECUTE replace(source,$text$'direct_arrive','depart'$text$,$text$'direct_arrive','depart','start_dropoff'$text$);

 source:=pg_get_functiondef('crest_commands.change_field_session(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,bigint,jsonb)'::regprocedure);
 definition:=replace(source,field_state,$text$   IF NOT(
    j.fulfillment_mode='mobile' AND (action IN('depart','direct_arrive') AND j.state='scheduled' AND j.first_work_at IS NULL
      OR action='arrive' AND j.state='en_route' AND j.first_work_at IS NULL)
    OR j.fulfillment_mode='dropoff' AND action='start_dropoff' AND j.state='scheduled' AND j.first_work_at IS NULL
    OR j.fulfillment_mode IN('mobile','dropoff') AND (action='pause' AND j.state='in_progress' OR action='resume' AND j.state='paused')
   ) THEN RAISE EXCEPTION USING ERRCODE='P1801',MESSAGE='state';END IF;$text$);
 definition:=replace(definition,field_stamp,field_stamp||$text$
   IF action='start_dropoff' AND NOT crest_private.dropoff_work_ready(requested_business,j.id,stamp)
   THEN RAISE EXCEPTION USING ERRCODE='P1801',MESSAGE='custody';END IF;$text$);
 EXECUTE definition;

 source:=pg_get_functiondef('crest_private.original_operation_reference_valid(jsonb)'::regprocedure);
 EXECUTE replace(source,action_list,action_list||$text$,'start_dropoff'$text$);
END $extend$;
