-- Held over the Drop-Off policy candidate. Storage only. No upload, browser
-- read, publication authority or production activation is granted here.
SET LOCAL ROLE crest_schema_owner;

CREATE TABLE crest.custody_photo_attempts (
 id uuid PRIMARY KEY,
 business_id uuid NOT NULL,
 job_id uuid NOT NULL,
 job_vehicle_id uuid NOT NULL,
 vehicle_id uuid NOT NULL,
 -- The receipt attempt can precede creation of this case. Publication and
 -- handoff must recheck the live case and job under their existing lock.
 case_id uuid NOT NULL,
 handoff_version smallint NOT NULL CHECK (handoff_version IN (1,2)),
 actor_id uuid NOT NULL,
 recovery_epoch uuid NOT NULL,
 dispatch_id uuid NOT NULL UNIQUE,
 declared_type text NOT NULL CHECK (declared_type IN ('image/jpeg','image/png','image/heic')),
 byte_size integer NOT NULL CHECK (byte_size BETWEEN 1 AND 26214400),
 reserved_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK (isfinite(reserved_at)),
 UNIQUE (business_id,id),
 UNIQUE (business_id,id,declared_type,byte_size),
 FOREIGN KEY (business_id,job_vehicle_id,job_id,vehicle_id)
  REFERENCES crest.job_vehicles(business_id,id,job_id,vehicle_id),
 FOREIGN KEY (business_id,job_id,actor_id) REFERENCES crest.jobs(business_id,id,operator_actor_id),
 FOREIGN KEY (business_id,actor_id) REFERENCES crest.memberships(business_id,actor_id)
);

CREATE TABLE crest.custody_photo_originals (
 business_id uuid NOT NULL,
 photo_id uuid NOT NULL,
 detected_type text NOT NULL,
 byte_size integer NOT NULL,
 sha256 text NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
 validation_version text NOT NULL,
 width integer NOT NULL CHECK (width > 0),
 height integer NOT NULL CHECK (height > 0),
 display_width integer,
 display_height integer,
 bit_depth integer,
 preview_sha256 text NOT NULL CHECK (preview_sha256 ~ '^[a-f0-9]{64}$'),
 preview_byte_size integer NOT NULL CHECK (preview_byte_size BETWEEN 1 AND 8388608),
 preview_width integer NOT NULL CHECK (preview_width BETWEEN 1 AND 2048),
 preview_height integer NOT NULL CHECK (preview_height BETWEEN 1 AND 2048),
 verified_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK (isfinite(verified_at)),
 PRIMARY KEY (business_id,photo_id),
 FOREIGN KEY (business_id,photo_id,detected_type,byte_size)
  REFERENCES crest.custody_photo_attempts(business_id,id,declared_type,byte_size),
 CHECK (width::bigint * height <= 60000000),
 CHECK (CASE WHEN detected_type='image/heic' THEN
  (display_width > 0 AND display_height > 0 AND display_width::bigint * display_height <= 60000000
   AND bit_depth BETWEEN 8 AND 16) IS TRUE
  ELSE display_width IS NULL AND display_height IS NULL AND bit_depth IS NULL END),
 CHECK (validation_version = CASE detected_type
  WHEN 'image/heic' THEN 'crest-heic-v1-libheif-1.23.6-libde265-1.1.3-sharp-0.35.5'
  ELSE 'crest-image-v1-sharp-0.35.5' END)
);

ALTER TABLE crest.custody_photo_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE crest.custody_photo_attempts FORCE ROW LEVEL SECURITY;
ALTER TABLE crest.custody_photo_originals ENABLE ROW LEVEL SECURITY;
ALTER TABLE crest.custody_photo_originals FORCE ROW LEVEL SECURITY;
REVOKE ALL ON crest.custody_photo_attempts,crest.custody_photo_originals
 FROM PUBLIC,anon,authenticated,crest_web,crest_worker,crest_export;

CREATE TRIGGER custody_photo_attempt_retain BEFORE UPDATE OR DELETE OR TRUNCATE ON crest.custody_photo_attempts
 FOR EACH STATEMENT EXECUTE FUNCTION crest_private.field_retain_source();
CREATE TRIGGER custody_photo_original_retain BEFORE UPDATE OR DELETE OR TRUNCATE ON crest.custody_photo_originals
 FOR EACH STATEMENT EXECUTE FUNCTION crest_private.field_retain_source();

GRANT SELECT ON crest.custody_photo_attempts,crest.custody_photo_originals TO crest_booking_integrity_owner;
CREATE POLICY custody_photo_attempt_check ON crest.custody_photo_attempts
 FOR SELECT TO crest_booking_integrity_owner USING(true);
CREATE POLICY custody_photo_original_check ON crest.custody_photo_originals
 FOR SELECT TO crest_booking_integrity_owner USING(true);
RESET ROLE;

-- Use from the protected custody save and event guard only. A photo reserved
-- or verified for a different job, case, handoff or recovery epoch never
-- satisfies the requirement. Historical photo reads are a separate contract.
CREATE FUNCTION crest_private.verified_dropoff_photo(
 business uuid, photo uuid, job_vehicle uuid, custody_case uuid,
 handoff integer, epoch uuid
) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
 SET search_path=pg_catalog,pg_temp SET row_security=on AS $photo$
 SELECT EXISTS(
  SELECT 1 FROM crest.custody_photo_attempts a
  JOIN crest.custody_photo_originals o ON (o.business_id,o.photo_id)=(a.business_id,a.id)
  WHERE (a.business_id,a.id,a.job_vehicle_id,a.case_id,a.handoff_version,a.recovery_epoch)
       =(business,photo,job_vehicle,custody_case,handoff,epoch)
    AND o.verified_at>=a.reserved_at
 )
$photo$;
ALTER FUNCTION crest_private.verified_dropoff_photo(uuid,uuid,uuid,uuid,integer,uuid)
 OWNER TO crest_booking_integrity_owner;
REVOKE ALL ON FUNCTION crest_private.verified_dropoff_photo(uuid,uuid,uuid,uuid,integer,uuid)
 FROM PUBLIC,anon,authenticated,crest_web,crest_worker,crest_export;
GRANT EXECUTE ON FUNCTION crest_private.verified_dropoff_photo(uuid,uuid,uuid,uuid,integer,uuid)
 TO crest_booking_owner;
