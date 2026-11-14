-- Candidate authenticated reader for the registered append-only support trips.
CREATE FUNCTION crest_private.support_trip_browser_row(leg crest.travel_legs)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $row$
 SELECT jsonb_build_object(
  'legId',leg.logical_id,'legVersionId',leg.id,'sequence',leg.sequence::text,
  'drivenVehicleId',leg.driven_vehicle_id,'jobId',leg.job_context_id,'purpose',leg.purpose,
  'origin',leg.origin_snapshot,'destination',leg.destination_snapshot,'notes',leg.notes,
  'departedAt',to_char(leg.departed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'arrivedAt',to_char(leg.arrived_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'state',leg.state,'reason',leg.reason,
  'recordedAt',to_char(leg.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))
$row$;
ALTER FUNCTION crest_private.support_trip_browser_row(crest.travel_legs) OWNER TO crest_booking_owner;
REVOKE ALL ON FUNCTION crest_private.support_trip_browser_row(crest.travel_legs) FROM PUBLIC;

CREATE FUNCTION crest_commands.read_support_trips(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,
 expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,
 requested_business uuid,after_departed_at timestamptz,after_leg uuid,page_size integer
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
 SET search_path=pg_catalog,pg_temp SET row_security=on AS $read$
DECLARE authority jsonb; result jsonb;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF (after_departed_at IS NULL)<>(after_leg IS NULL) OR (after_departed_at IS NOT NULL AND NOT isfinite(after_departed_at))
  OR page_size IS NULL OR page_size NOT BETWEEN 1 AND 20
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_SUPPORT_TRIPS_INPUT_REQUIRED'; END IF;
 authority:=crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);
 PERFORM set_config('crest.business_id',authority->>'businessId',true),set_config('crest.actor_id',authority->>'actorId',true);
 WITH active AS (
  SELECT crest_private.support_trip_browser_row(ROW(l.*)::crest.travel_legs) AS row FROM crest.current_travel_legs l
  WHERE l.business_id=requested_business AND l.operator_actor_id=expected_actor
    AND l.purpose IN('supply','between_jobs','return_to_base','other') AND l.state='open'
 ), retained AS MATERIALIZED (
  SELECT l.departed_at,l.logical_id,crest_private.support_trip_browser_row(ROW(l.*)::crest.travel_legs) AS row
  FROM crest.current_travel_legs l WHERE l.business_id=requested_business AND l.operator_actor_id=expected_actor
    AND l.purpose IN('supply','between_jobs','return_to_base','other') AND l.state IN('closed','cancelled')
    AND (after_leg IS NULL OR (l.departed_at,l.logical_id)<(after_departed_at,after_leg))
  ORDER BY l.departed_at DESC,l.logical_id DESC LIMIT page_size+1
 ), visible AS (
  SELECT * FROM retained ORDER BY departed_at DESC,logical_id DESC LIMIT page_size
 )
 SELECT jsonb_build_object('schemaVersion',1,'businessId',requested_business,'active',(SELECT row FROM active),
  'trips',coalesce((SELECT jsonb_agg(row ORDER BY departed_at DESC,logical_id DESC) FROM visible),'[]'::jsonb),
  'hasMore',(SELECT count(*)>page_size FROM retained)) INTO result;
 PERFORM crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);
 RETURN result;
END $read$;

CREATE FUNCTION crest_commands.read_support_trip_history(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,
 expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,
 requested_business uuid,requested_leg uuid,after_version bigint,through_version bigint,page_size integer
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
 SET search_path=pg_catalog,pg_temp SET row_security=on AS $read$
DECLARE authority jsonb; result jsonb;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF requested_leg IS NULL OR after_version IS NULL OR through_version IS NULL OR after_version<0 OR through_version<=after_version
  OR page_size IS NULL OR page_size NOT BETWEEN 1 AND 20
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_SUPPORT_HISTORY_INPUT_REQUIRED'; END IF;
 authority:=crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);
 PERFORM set_config('crest.business_id',authority->>'businessId',true),set_config('crest.actor_id',authority->>'actorId',true);
 WITH visible AS (
  SELECT l.sequence,crest_private.support_trip_browser_row(l) AS row FROM crest.travel_legs l
  WHERE l.business_id=requested_business AND l.operator_actor_id=expected_actor AND l.logical_id=requested_leg
    AND l.purpose IN('supply','between_jobs','return_to_base','other') AND l.sequence>after_version AND l.sequence<=through_version
  ORDER BY l.sequence LIMIT page_size
 )
 SELECT jsonb_build_object('schemaVersion',1,'businessId',requested_business,'legId',requested_leg,
  'throughVersion',through_version::text,'trips',coalesce((SELECT jsonb_agg(row ORDER BY sequence) FROM visible),'[]'::jsonb),
  'hasMore',(SELECT max(sequence)<through_version FROM visible))
 INTO result FROM crest.current_travel_legs l WHERE l.business_id=requested_business AND l.operator_actor_id=expected_actor
  AND l.logical_id=requested_leg AND l.purpose IN('supply','between_jobs','return_to_base','other') AND l.sequence>=through_version;
 PERFORM crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);
 RETURN coalesce(result,jsonb_build_object('state','not_found'));
END $read$;

ALTER FUNCTION crest_commands.read_support_trips(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,timestamptz,uuid,integer) OWNER TO crest_booking_owner;
ALTER FUNCTION crest_commands.read_support_trip_history(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,bigint,bigint,integer) OWNER TO crest_booking_owner;
REVOKE ALL ON FUNCTION crest_commands.read_support_trips(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,timestamptz,uuid,integer),
 crest_commands.read_support_trip_history(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,bigint,bigint,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.read_support_trips(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,timestamptz,uuid,integer),
 crest_commands.read_support_trip_history(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,bigint,bigint,integer) TO crest_web;

CREATE FUNCTION crest_commands.read_support_trip_mileage(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,
 expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,
 requested_business uuid,requested_leg uuid
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
 SET search_path=pg_catalog,pg_temp SET row_security=on AS $read$
DECLARE authority jsonb; result jsonb;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF requested_leg IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_SUPPORT_MILEAGE_INPUT_REQUIRED'; END IF;
 authority:=crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);
 PERFORM set_config('crest.business_id',authority->>'businessId',true),set_config('crest.actor_id',authority->>'actorId',true);
 SELECT jsonb_build_object('schemaVersion',1,'businessId',l.business_id,'trip',jsonb_build_object(
   'legId',l.logical_id,'legVersionId',l.id,'evidenceVersion',coalesce(e.sequence,0)::text,
   'departedAt',to_char(l.departed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
   'arrivedAt',to_char(l.arrived_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
   'state',l.state,'purpose',l.purpose,'distanceStatus',coalesce(e.distance_status,'unresolved')
 )) INTO result FROM crest.current_travel_legs l
 LEFT JOIN crest.current_mileage_evidence e ON e.business_id=l.business_id AND e.leg_id=l.logical_id
 WHERE l.business_id=requested_business AND l.operator_actor_id=expected_actor AND l.logical_id=requested_leg
  AND l.purpose IN('supply','between_jobs','return_to_base','other') AND l.state IN('closed','cancelled');
 PERFORM crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);
 RETURN coalesce(result,jsonb_build_object('state','not_found'));
END $read$;
ALTER FUNCTION crest_commands.read_support_trip_mileage(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid) OWNER TO crest_booking_owner;
REVOKE ALL ON FUNCTION crest_commands.read_support_trip_mileage(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.read_support_trip_mileage(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid) TO crest_web;
