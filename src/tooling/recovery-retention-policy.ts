// EXPORTS_AND_BACKUPS6 calendar planning over an authoritative complete-point
// inventory. This function neither authenticates that inventory nor mutates it.
const day=86400000;
export class RecoveryRetentionPolicyError extends Error{constructor(){super('RECOVERY_RETENTION_REVIEW_REQUIRED');this.name='RecoveryRetentionPolicyError';}}
function require(value:unknown):asserts value{if(!value)throw new RecoveryRetentionPolicyError();}
function instant(value:string){require(typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value));const result=Date.parse(value);require(Number.isSafeInteger(result)&&new Date(result).toISOString()===value&&result>=Date.UTC(2001,0,1)&&result<Date.UTC(9998,0,1));return result;}
type Point=Readonly<{pointId:string;snapshotAt:string;completedAt:string;retainUntil:string}>;
type Designation=Readonly<{kind:'daily'|'month_end';localDate:string;boundaryExclusive:string;pointId:string|null;minimumRetainUntil:string}>;
export function planRecoveryRetention(input:Readonly<{now:string;timeZone:string;points:readonly Point[]}>){
 try{
  const now=instant(input.now);require(typeof input.timeZone==='string'&&input.timeZone.length<=100&&input.timeZone.trim()===input.timeZone&&Array.isArray(input.points)&&input.points.length<=10000);
  // Refuse numeric offset zones: calendar policy must retain an explicit IANA
  // timezone (UTC is also valid), including its actual historical transitions.
  require(input.timeZone==='UTC'||/^[A-Za-z0-9_+-]+\/[A-Za-z0-9_+-]+(?:\/[A-Za-z0-9_+-]+)?$/.test(input.timeZone));
  const formatter=new Intl.DateTimeFormat('en-CA',{timeZone:input.timeZone,calendar:'iso8601',numberingSystem:'latn',year:'numeric',month:'2-digit',day:'2-digit'});
  const dateKey=(at:number)=>{const p=formatter.formatToParts(new Date(at)),part=(type:string)=>p.find(x=>x.type===type)?.value;const result=part('year')+'-'+part('month')+'-'+part('day');require(/^\d{4}-\d{2}-\d{2}$/.test(result));return result;};
  function startOfLocalDate(key:string){
   const utc=Date.parse(key+'T00:00:00.000Z');let lo=utc-2*day,hi=utc+2*day;
   require(dateKey(lo)<key&&dateKey(hi)>key);
   while(lo+1<hi){const middle=Math.floor((lo+hi)/2);if(dateKey(middle)<key)lo=middle;else hi=middle;}
   // Midnight gaps use the first existing instant of the local day. Entirely
   // skipped dates refuse; they must never silently become a different day.
   require(dateKey(hi)===key&&dateKey(hi-1)<key);return hi;
  }
  const ids=new Set<string>(),points=input.points.map(point=>{
   require(point&&typeof point.pointId==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(point.pointId)&&!ids.has(point.pointId));ids.add(point.pointId);
   const snapshot=instant(point.snapshotAt),completed=instant(point.completedAt),retained=instant(point.retainUntil);require(snapshot<=completed&&completed<=now&&retained>=completed);
   return{...point,snapshot,completed,retained};
  }).sort((a,b)=>a.completed-b.completed||a.snapshot-b.snapshot||a.pointId.localeCompare(b.pointId));
  const needs=new Map(points.map(point=>[point.pointId,{point,minimum:point.snapshot+7*day,reasons:[] as Designation[]}])),designations:Designation[]=[];
  const today=dateKey(now),todayUtc=Date.parse(today+'T00:00:00.000Z');
  function select(kind:'daily'|'month_end',localDate:string,boundary:number,days:number){
   require(boundary<=now);let chosen:typeof points[number]|undefined;
   // Last successful completion strictly before the next local calendar day,
   // never a run that only finishes after the boundary or an incomplete run.
   const lower=kind==='daily'?startOfLocalDate(localDate):-Infinity;
   for(const point of points){if(point.completed>=boundary)break;if(point.completed>=lower)chosen=point;}
   const until=boundary+days*day,designation=Object.freeze({kind,localDate,boundaryExclusive:new Date(boundary).toISOString(),pointId:chosen?.pointId??null,minimumRetainUntil:new Date(until).toISOString()});designations.push(designation);
   if(chosen){const need=needs.get(chosen.pointId)!;need.minimum=Math.max(need.minimum,until);need.reasons.push(designation);}
  }
  // Keep35 designated daily points for the documented safety margin above30.
  for(let offset=0;offset<35;offset++){
   const nextDate=new Date(todayUtc-offset*day).toISOString().slice(0,10),localDate=new Date(todayUtc-(offset+1)*day).toISOString().slice(0,10);
   select('daily',localDate,startOfLocalDate(nextDate),35);
  }
  // Include every closed month whose400-day protection interval is still live,
  // rather than dropping the thirteenth boundary on a calendar-count shortcut.
  const year=Number(today.slice(0,4)),month=Number(today.slice(5,7))-1;
  for(let offset=0;offset<15;offset++){
   const nextDate=new Date(Date.UTC(year,month-offset,1)).toISOString().slice(0,10),boundary=startOfLocalDate(nextDate);
   if(boundary+400*day<=now)break;
   select('month_end',new Date(Date.parse(nextDate+'T00:00:00.000Z')-day).toISOString().slice(0,10),boundary,400);
  }
  const planned=Object.freeze([...needs.values()].map(({point,minimum,reasons})=>Object.freeze({pointId:point.pointId,minimumRetainUntil:new Date(minimum).toISOString(),retainUntil:new Date(Math.max(minimum,point.retained)).toISOString(),existingLockInsufficient:point.retained<minimum,existingLockExpired:point.retained<=now,currentlyRequired:minimum>now,designations:Object.freeze(reasons)})));
  return Object.freeze({profile:'crest.recovery-retention-plan.v1' as const,evaluatedAt:input.now,timeZone:input.timeZone,points:planned,designations:Object.freeze(designations),missingBoundaryCount:designations.filter(x=>x.pointId===null).length,inventoryAuthenticated:false as const,retentionApplied:false as const,originalDeletionAuthorized:false as const,completeBackup:false as const});
 }catch{throw new RecoveryRetentionPolicyError();}
}
