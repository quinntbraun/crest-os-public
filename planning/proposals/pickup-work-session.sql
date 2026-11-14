-- Held BR07/BR08 work start, completion and no-fulfilled-work cancellation
-- after separately recorded transport to the work site.
RESET ROLE;
SET LOCAL ROLE crest_schema_owner;
CREATE FUNCTION crest_private.pickup_work_ready(business uuid,job uuid,stamp timestamptz,require_held boolean)
 RETURNS boolean LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp SET row_security=on AS $ready$
 SELECT EXISTS(SELECT 1 FROM crest.job_vehicles vehicle WHERE vehicle.business_id=business AND vehicle.job_id=job)
  AND NOT EXISTS(
   SELECT 1 FROM crest.job_vehicles vehicle
   WHERE vehicle.business_id=business AND vehicle.job_id=job AND NOT EXISTS(
    SELECT 1 FROM crest_private.pickup_custody_collections collection
    JOIN crest.travel_legs leg ON leg.business_id=collection.business_id AND leg.job_context_id=collection.job_id
    JOIN crest_private.operations operation ON (operation.business_id,operation.operation_id,operation.actor_id)
     =(leg.business_id,leg.operation_id,leg.created_by)
    WHERE (collection.business_id,collection.job_id,collection.job_vehicle_id,collection.vehicle_id)
     =(vehicle.business_id,vehicle.job_id,vehicle.id,vehicle.vehicle_id)
     AND collection.recorded_at<=leg.departed_at AND leg.arrived_at<=stamp
     AND leg.purpose='to_work_site' AND leg.state='closed' AND leg.change_kind='arrive'
     AND operation.command_type='operations.pickup_trip.record' AND operation.state='committed'
     AND operation.result->'receipt'->'jobVehicleIds' ? collection.job_vehicle_id::text
     AND (NOT require_held OR EXISTS(
      SELECT 1 FROM crest_private.vehicle_custody_claims claim
      WHERE (claim.business_id,claim.vehicle_id,claim.pickup_collection_id)
       =(collection.business_id,collection.vehicle_id,collection.id)
     ))
   )
  )
$ready$;
REVOKE ALL ON FUNCTION crest_private.pickup_work_ready(uuid,uuid,timestamptz,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.pickup_work_ready(uuid,uuid,timestamptz,boolean) TO crest_booking_owner,crest_booking_integrity_owner;
RESET ROLE;

DO $review$
DECLARE entry record; replacement record; routine regprocedure; definition text;
BEGIN
 FOR entry IN SELECT * FROM (VALUES
  ('crest_commands.read_pickup_trips(bytea, uuid, uuid, text, uuid, uuid, timestamp with time zone, uuid, uuid, timestamp with time zone, uuid)',
   'crest_booking_owner',true,'v','02e8728014e6fa9cff8edf5905a6b4f6eb65347040f8300fc4bb08bca74a0a72',$map$[{"marker":"  'worksiteVehicleIds',coalesce((","value":"  'worksiteReady',j.state='scheduled' AND crest_private.pickup_work_ready(requested_business,j.id,statement_timestamp(),true),\n  'worksiteVehicleIds',coalesce((","occurrences":1}]$map$::jsonb),
  ('crest_commands.read_pickup_collection(bytea, uuid, uuid, text, uuid, uuid, timestamp with time zone, uuid, uuid, uuid)',
   'crest_booking_owner',true,'v','2be63ad9d6b9f5113da21e3b2fccf8777898155d8906522fc95378bdd7f82e09',$map$[{"marker":"status:=CASE WHEN job.state='cancelled' THEN 'return_required' ELSE 'held' END;","value":"status:=CASE job.state WHEN 'cancelled' THEN 'return_required' WHEN 'completed' THEN 'awaiting_return' ELSE 'held' END;","occurrences":1}]$map$::jsonb),
  ('crest_commands.cancel_unfulfilled_job(bytea, uuid, uuid, text, uuid, uuid, timestamp with time zone, uuid, uuid, uuid, integer, uuid, bigint, jsonb)','crest_booking_owner',true,'v','84c753a17368c0703685d83db8c1673187afc6e70243f2f11a717b9eed13f72b',$map$[
  {
    "marker": "before_job.fulfillment_mode NOT IN('mobile','dropoff')",
    "value": "before_job.fulfillment_mode NOT IN('mobile','dropoff','pickup_return')",
    "occurrences": 1
  }
]$map$::jsonb),
  ('crest_commands.change_field_session(bytea, uuid, uuid, text, uuid, uuid, timestamp with time zone, uuid, uuid, uuid, integer, uuid, bigint, jsonb)','crest_booking_owner',true,'v','a0c2b33ff16fd0614e9804b99a38db729ee3418143fbedcbb556a4d2c7d0209f',$map$[
  {
    "marker": "    OR j.fulfillment_mode='dropoff' AND action='start_dropoff' AND j.state='scheduled' AND j.first_work_at IS NULL",
    "value": "    OR j.fulfillment_mode='dropoff' AND action='start_dropoff' AND j.state='scheduled' AND j.first_work_at IS NULL\n    OR j.fulfillment_mode='pickup_return' AND action='start_pickup' AND j.state='scheduled' AND j.first_work_at IS NULL",
    "occurrences": 1
  },
  {
    "marker": "j.fulfillment_mode IN('mobile','dropoff')",
    "value": "j.fulfillment_mode IN('mobile','dropoff','pickup_return')",
    "occurrences": 1
  },
  {
    "marker": "   IF action='start_dropoff' AND NOT crest_private.dropoff_work_ready(requested_business,j.id,stamp)",
    "value": "   IF action='start_pickup' AND NOT crest_private.pickup_work_ready(requested_business,j.id,stamp,true)\n   THEN RAISE EXCEPTION USING ERRCODE='P1801',MESSAGE='custody';END IF;\n   IF action='start_dropoff' AND NOT crest_private.dropoff_work_ready(requested_business,j.id,stamp)",
    "occurrences": 1
  }
]$map$::jsonb),
  ('crest_commands.complete_job(bytea, uuid, uuid, text, uuid, uuid, timestamp with time zone, uuid, uuid, uuid, integer, uuid, bigint, jsonb)','crest_booking_owner',true,'v','bd37c11aa0a94e3b3bd1adb53f40e9809ccdfc31dad495f1ce2db0ac71d7d6bd',$map$[
  {
    "marker": "j.fulfillment_mode NOT IN('mobile','dropoff')",
    "value": "j.fulfillment_mode NOT IN('mobile','dropoff','pickup_return')",
    "occurrences": 1
  }
]$map$::jsonb),
  ('crest_commands.read_job_completion_context(bytea, uuid, uuid, text, uuid, uuid, timestamp with time zone, uuid, uuid)','crest_booking_owner',true,'v','2a640a10855db3cbe24aa886268cb2fa6f43a22587ae78599bea4177f915e3f6',$map$[
  {
    "marker": "j.fulfillment_mode IN('mobile','dropoff')",
    "value": "j.fulfillment_mode IN('mobile','dropoff','pickup_return')",
    "occurrences": 2
  }
]$map$::jsonb),
  ('crest_commands.read_unfulfilled_cancellation_context(bytea, uuid, uuid, text, uuid, uuid, timestamp with time zone, uuid, uuid)','crest_booking_owner',true,'v','eea6db39fc156df075b7b0778d7dbb750de224a9b11f2840e880ee6f1f0d0323',$map$[
  {
    "marker": "j.fulfillment_mode IN('mobile','dropoff')",
    "value": "j.fulfillment_mode IN('mobile','dropoff','pickup_return')",
    "occurrences": 1
  }
]$map$::jsonb),
  ('crest_private.check_completed_job_graph(uuid, uuid, uuid)','crest_booking_integrity_owner',true,'v','13577757d5719ab599d224587ac9cbd695e2c20dd9bc0e8d4ba45016ea0762fc',$map$[
  {
    "marker": "j.fulfillment_mode NOT IN('mobile','dropoff')",
    "value": "j.fulfillment_mode NOT IN('mobile','dropoff','pickup_return')",
    "occurrences": 1
  }
]$map$::jsonb),
  ('crest_private.check_field_session_graph(uuid, uuid, uuid)','crest_booking_integrity_owner',true,'v','04839f7b364bf1d95ecf4e92845ab6f15ed2a90546a162b56cd61cfd00d6ee62',$map$[
  {
    "marker": "OR j.fulfillment_mode='dropoff' AND action IN('start_dropoff','pause','resume'))",
    "value": "OR j.fulfillment_mode='dropoff' AND action IN('start_dropoff','pause','resume')\n     OR j.fulfillment_mode='pickup_return' AND action IN('start_pickup','pause','resume'))",
    "occurrences": 1
  },
  {
    "marker": "action IN('direct_arrive','arrive','start_dropoff')",
    "value": "action IN('direct_arrive','arrive','start_dropoff','start_pickup')",
    "occurrences": 2
  },
  {
    "marker": "   OR action='start_dropoff' AND NOT crest_private.dropoff_work_ready(business,job,e.effective_at)",
    "value": "   OR action='start_dropoff' AND NOT crest_private.dropoff_work_ready(business,job,e.effective_at)\n   OR action='start_pickup' AND NOT crest_private.pickup_work_ready(business,job,e.effective_at,false)",
    "occurrences": 1
  }
]$map$::jsonb),
  ('crest_private.field_session_result(uuid, uuid, uuid)','crest_booking_integrity_owner',true,'s','c6a883241a4deba36562f83ed35ceb6055e4bc911af670ece3fe52ebe31577d5',$map$[
  {
    "marker": "'direct_arrive','depart','start_dropoff'",
    "value": "'direct_arrive','depart','start_dropoff','start_pickup'",
    "occurrences": 1
  }
]$map$::jsonb),
  ('crest_private.field_source_stamp()','crest_booking_integrity_owner',true,'v','bc177a0e5ac4b76a62813483a9530e7509f189541dbdee9ebad9fcfe4b2c3b3b',$map$[
  {
    "marker": "AND fulfillment_mode IN('mobile','dropoff') AND first_work_at IS NOT NULL",
    "value": "AND fulfillment_mode IN('mobile','dropoff','pickup_return') AND first_work_at IS NOT NULL",
    "occurrences": 1
  }
]$map$::jsonb),
  ('crest_private.original_operation_reference_valid(jsonb)','crest_schema_owner',false,'i','ab90587c2e5b0f9e3547e72128c8907904916fb288b3a5c7251d0b08dcbc2ac8',$map$[
  {
    "marker": "'pause','resume','start_dropoff'",
    "value": "'pause','resume','start_dropoff','start_pickup'",
    "occurrences": 1
  }
]$map$::jsonb),
  ('crest_private.stamp_booking_row()','crest_booking_integrity_owner',true,'v','9938de6faf801dd0cd5141640ae204468de8469ec66d180ad0aaed4312fe030f',$map$[
  {
    "marker": "OLD.fulfillment_mode NOT IN('mobile','dropoff')",
    "value": "OLD.fulfillment_mode NOT IN('mobile','dropoff','pickup_return')",
    "occurrences": 1
  }
]$map$::jsonb),
  ('crest_private.unfulfilled_job_result(uuid, uuid, uuid)','crest_booking_integrity_owner',true,'s','f77297d7137886eb3fdac18e8fc784bf632151f49dab225c53941a03549d1f4a',$map$[
  {
    "marker": "before_job->>'fulfillment_mode' NOT IN('mobile','dropoff')",
    "value": "before_job->>'fulfillment_mode' NOT IN('mobile','dropoff','pickup_return')",
    "occurrences": 1
  }
]$map$::jsonb),
  ('crest_private.valid_field_session_body(jsonb)','crest_schema_owner',false,'i','1bdde85caafda3cd7b44b446846c246d2ac2ef61651d3468c43d9189e6d8a129',$map$[
  {
    "marker": "'pause','resume','start_dropoff'",
    "value": "'pause','resume','start_dropoff','start_pickup'",
    "occurrences": 1
  },
  {
    "marker": "'arrive','resume','start_dropoff'",
    "value": "'arrive','resume','start_dropoff','start_pickup'",
    "occurrences": 1
  }
]$map$::jsonb)
 ) expected(signature,owner,security_definer,volatility,digest,replacements) LOOP
  routine:=to_regprocedure(entry.signature);
  IF NOT EXISTS(
   SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid=p.prolang
   WHERE p.oid=routine AND p.proowner=entry.owner::regrole AND p.prosecdef=entry.security_definer
    AND p.provolatile::text=entry.volatility AND NOT p.proleakproof AND l.lanname='plpgsql'
    AND p.proconfig=CASE WHEN entry.security_definer THEN ARRAY['search_path=pg_catalog, pg_temp','row_security=on']
     ELSE ARRAY['search_path=pg_catalog, pg_temp'] END
    AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')=entry.digest
    AND NOT EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee=0)
  ) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_PICKUP_WORK_SOURCE_REVIEW_REQUIRED',DETAIL=entry.signature;END IF;
  definition:=pg_get_functiondef(routine);
  FOR replacement IN SELECT * FROM jsonb_to_recordset(entry.replacements) AS mapping(marker text,value text,occurrences integer) LOOP
   IF (length(definition)-length(replace(definition,replacement.marker,'')))/length(replacement.marker)<>replacement.occurrences
   THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_PICKUP_WORK_SOURCE_REVIEW_REQUIRED',DETAIL=entry.signature;END IF;
   definition:=replace(definition,replacement.marker,replacement.value);
  END LOOP;
  EXECUTE definition;
 END LOOP;
END $review$;
RESET ROLE;
