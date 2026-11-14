// Reconstruct the derived projection in a separate temporary table. Never
// deletes/rewrites Crest source or claims recovery-runtime authority.
import assert from 'node:assert/strict';
export async function verifyNeutralFieldOccupancyRebuild(c){
 await c.query('BEGIN');try{
  await c.query('CREATE TEMP TABLE rebuilt_operator_occupancy (LIKE crest.operator_occupancy INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING INDEXES) ON COMMIT DROP');
  await c.query("INSERT INTO rebuilt_operator_occupancy(business_id,source_kind,logical_id,operator_actor_id,job_id,work_interval_id,travel_leg_id,started_at,ended_at,occupied,work_span) SELECT w.business_id,'work',w.logical_id,w.operator_actor_id,w.job_id,w.id,NULL,w.started_at,w.ended_at,CASE WHEN w.kind='active' THEN tstzrange(w.started_at,w.ended_at,'[)') ELSE 'empty'::tstzrange END,tstzrange(w.started_at,w.ended_at,'[)') FROM crest.work_intervals w WHERE NOT EXISTS(SELECT 1 FROM crest.work_intervals newer WHERE newer.business_id=w.business_id AND newer.replaces_id=w.id)");
  await c.query("INSERT INTO rebuilt_operator_occupancy(business_id,source_kind,logical_id,operator_actor_id,job_id,work_interval_id,travel_leg_id,started_at,ended_at,occupied,work_span) SELECT l.business_id,'travel',l.logical_id,l.operator_actor_id,NULL,NULL,l.id,l.departed_at,l.arrived_at,tstzrange(l.departed_at,l.arrived_at,'[)'),'empty'::tstzrange FROM crest.travel_legs l WHERE NOT EXISTS(SELECT 1 FROM crest.travel_legs newer WHERE newer.business_id=l.business_id AND newer.replaces_id=l.id)");
  const expected=(await c.query("SELECT to_jsonb(o)-'id' value FROM crest.operator_occupancy o ORDER BY business_id,source_kind,logical_id")).rows.map(r=>r.value),actual=(await c.query("SELECT to_jsonb(o)-'id' value FROM rebuilt_operator_occupancy o ORDER BY business_id,source_kind,logical_id")).rows.map(r=>r.value);assert.deepEqual(actual,expected);
  const counts=(await c.query("SELECT count(*)::int total,count(*) FILTER(WHERE ended_at IS NULL AND source_kind='travel')::int open_travel,count(*) FILTER(WHERE ended_at IS NULL AND source_kind='work')::int open_work,count(*) FILTER(WHERE isempty(occupied) AND NOT isempty(work_span))::int pauses FROM rebuilt_operator_occupancy")).rows[0];
  const constraints=(await c.query("SELECT contype::text kind,count(*)::int n FROM pg_constraint WHERE conrelid='pg_temp.rebuilt_operator_occupancy'::regclass GROUP BY contype")).rows;
  assert.equal(constraints.find(r=>r.kind==='x')?.n,2);await c.query('COMMIT');return {...counts,physicalAndWorkSessionExclusions:2,originalProjectionUnchanged:true,recoveryRuntimeReinserted:false};
 }catch(e){await c.query('ROLLBACK');throw e;}
}
