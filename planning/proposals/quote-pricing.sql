-- Unregistered BR04 construction over registered44. No tables, runtime grants,
-- migration ordinal, provider changes or production activation.
DO $review$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='crest_schema_owner' AND NOT(rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls) AND rolconfig IS NULL)
  OR to_regprocedure('crest_private.quote_discount_cents(jsonb,numeric)') IS NOT NULL
  OR to_regprocedure('crest_private.calculate_quote_pricing(jsonb,jsonb)') IS NOT NULL
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_QUOTE_PRICING_REVIEW_REQUIRED';END IF;
END $review$;
SET LOCAL ROLE crest_schema_owner;

CREATE FUNCTION crest_private.quote_discount_cents(discount jsonb,base numeric) RETURNS numeric
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $discount$
DECLARE amount numeric; entered text;
BEGIN
 IF base IS NULL OR base<0 OR base<>trunc(base) OR base>9223372036854775807 THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_QUOTE_PRICING_INVALID';
 END IF;
 IF discount='null'::jsonb THEN RETURN 0;END IF;
 IF jsonb_typeof(discount) IS DISTINCT FROM 'object' THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_QUOTE_PRICING_INVALID';
 END IF;
 IF discount->>'kind'='fixed' AND discount ?& ARRAY['kind','cents'] AND discount-ARRAY['kind','cents']='{}'::jsonb
  AND jsonb_typeof(discount->'cents')='string' THEN
  entered:=discount->>'cents';
  IF entered!~'^(0|[1-9][0-9]{0,18})$' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_QUOTE_PRICING_INVALID';END IF;
  amount:=entered::numeric;
 ELSIF discount->>'kind'='percent' AND discount ?& ARRAY['kind','rate'] AND discount-ARRAY['kind','rate']='{}'::jsonb
  AND jsonb_typeof(discount->'rate')='string' THEN
  entered:=discount->>'rate';
  IF entered!~'^(0|1)(\.[0-9]{1,8})?$' OR entered::numeric>1 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_QUOTE_PRICING_INVALID';END IF;
  amount:=round(base*entered::numeric,0);
 ELSE RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_QUOTE_PRICING_INVALID';END IF;
 IF amount>base THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_QUOTE_DISCOUNT_EXCEEDS_AMOUNT';END IF;
 RETURN amount;
END $discount$;

CREATE FUNCTION crest_private.calculate_quote_pricing(lines jsonb,document_discount jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $calculate$
DECLARE item jsonb; rows jsonb:='[]'::jsonb; result_rows jsonb; seen text[]:='{}'; identifier text;
 gross numeric; line_discount numeric; remaining numeric; gross_total numeric:=0; line_total numeric:=0;
 eligible_total numeric:=0; document_total numeric; total numeric; reason text;
BEGIN
 IF jsonb_typeof(lines) IS DISTINCT FROM 'array' OR jsonb_array_length(lines) NOT BETWEEN 1 AND 1000 THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_QUOTE_PRICING_INVALID';
 END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(lines) LOOP
  IF jsonb_typeof(item) IS DISTINCT FROM 'object'
   OR NOT(item ?& ARRAY['id','grossCents','lineDiscount','documentDiscountEligible','complimentaryReason'])
   OR item-ARRAY['id','grossCents','lineDiscount','documentDiscountEligible','complimentaryReason']<>'{}'::jsonb
   OR jsonb_typeof(item->'id') IS DISTINCT FROM 'string'
   OR jsonb_typeof(item->'grossCents') IS DISTINCT FROM 'string'
   OR jsonb_typeof(item->'documentDiscountEligible') IS DISTINCT FROM 'boolean'
   OR jsonb_typeof(item->'complimentaryReason') NOT IN('string','null') THEN
   RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_QUOTE_PRICING_INVALID';
  END IF;
  identifier:=item->>'id';
  IF identifier!~'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' OR identifier=ANY(seen)
   OR (item->>'grossCents')!~'^(0|[1-9][0-9]{0,18})$' THEN
   RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_QUOTE_PRICING_INVALID';
  END IF;
  seen:=array_append(seen,identifier);gross:=(item->>'grossCents')::numeric;
  IF gross>9223372036854775807 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_QUOTE_PRICING_INVALID';END IF;
  reason:=item->>'complimentaryReason';
  IF reason IS NOT NULL AND (char_length(reason)>1000 OR btrim(reason,E'\t\n\r\u000b\f \u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff')='' OR translate(reason,E'\t\n\r','')~'[[:cntrl:]]') THEN
   RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_QUOTE_PRICING_INVALID';
  END IF;
  line_discount:=crest_private.quote_discount_cents(item->'lineDiscount',gross);remaining:=gross-line_discount;
  gross_total:=gross_total+gross;line_total:=line_total+line_discount;
  IF gross_total>9223372036854775807 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_QUOTE_PRICING_INVALID';END IF;
  IF (item->>'documentDiscountEligible')::boolean THEN eligible_total:=eligible_total+remaining;END IF;
  rows:=rows||jsonb_build_array(jsonb_build_object('id',identifier,'gross',gross,'lineDiscount',line_discount,'remaining',remaining,'eligible',(item->>'documentDiscountEligible')::boolean,'reason',reason));
 END LOOP;
 document_total:=crest_private.quote_discount_cents(document_discount,eligible_total);
 WITH source AS(
  SELECT value,ordinality,CASE WHEN (value->>'eligible')::boolean THEN (value->>'remaining')::numeric ELSE 0::numeric END AS weight
  FROM jsonb_array_elements(rows) WITH ORDINALITY
 ), shares AS(
  SELECT *,CASE WHEN eligible_total>0 THEN div(document_total*weight,eligible_total) ELSE 0::numeric END AS allocated,
   CASE WHEN eligible_total>0 THEN mod(document_total*weight,eligible_total) ELSE 0::numeric END AS remainder FROM source
 ), ranked AS(
  SELECT ordinality,row_number() OVER(ORDER BY remainder DESC,ordinality) AS position FROM shares WHERE weight>0
 ), allocations AS(
  SELECT s.*,s.allocated+CASE WHEN r.position<=document_total-(SELECT sum(allocated) FROM shares) THEN 1 ELSE 0 END AS actual
  FROM shares s LEFT JOIN ranked r USING(ordinality)
 )
 SELECT jsonb_agg(jsonb_build_object('id',value->>'id','grossCents',trunc((value->>'gross')::numeric)::text,
  'lineDiscountCents',trunc((value->>'lineDiscount')::numeric)::text,'allocatedDiscountCents',trunc(actual)::text,
  'finalCents',trunc((value->>'remaining')::numeric-actual)::text,'documentDiscountEligible',(value->>'eligible')::boolean,
  'complimentaryReason',value->'reason') ORDER BY ordinality) INTO result_rows FROM allocations;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(result_rows) v WHERE (v->>'finalCents')::numeric<0)
  OR (SELECT sum((v->>'allocatedDiscountCents')::numeric) FROM jsonb_array_elements(result_rows) v)<>document_total THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_QUOTE_PRICING_INVALID';
 END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(result_rows) v WHERE (v->>'finalCents')::numeric=0 AND v->'complimentaryReason'='null'::jsonb) THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_QUOTE_COMPLIMENTARY_REASON_REQUIRED';
 END IF;
 total:=gross_total-line_total-document_total;
 IF (SELECT sum((v->>'finalCents')::numeric) FROM jsonb_array_elements(result_rows) v)<>total THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_QUOTE_PRICING_INVALID';
 END IF;
 RETURN jsonb_build_object('currency','USD','grossCents',trunc(gross_total)::text,'lineDiscountCents',trunc(line_total)::text,
  'documentDiscountCents',trunc(document_total)::text,'totalCents',trunc(total)::text,'lines',result_rows);
END $calculate$;
REVOKE ALL ON FUNCTION crest_private.quote_discount_cents(jsonb,numeric),crest_private.calculate_quote_pricing(jsonb,jsonb) FROM PUBLIC;
