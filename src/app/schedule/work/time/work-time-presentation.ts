import type {LoadedJobWorkTime} from '../../../../operations/job-work-time-contract';
export type SavedWorkInterval=LoadedJobWorkTime['intervals'][number];
export function workTimeDuration(microseconds:string){
 const exact=BigInt(microseconds),seconds=exact/1000000n;
 if(exact>0n&&seconds===0n)return '<1s';
 const hours=seconds/3600n,minutes=(seconds/60n)%60n;
 return [hours?hours+'h':'',hours||minutes?minutes+'m':'',seconds%60n+'s'].filter(Boolean).join(' ');
}
export function workIntervalChain(data:LoadedJobWorkTime,current:SavedWorkInterval){
 if(!data.intervals.some(row=>row.versionId===current.versionId&&row.intervalId===current.intervalId))return null;
 const rows=data.record.intervalVersions.filter(row=>row.intervalId===current.intervalId);
 if(rows.at(-1)?.versionId!==current.versionId)return null;
 for(let i=0;i<rows.length;i++){
  const row=rows[i]!,previous=rows[i-1];
  if(previous?row.replacesVersionId!==previous.versionId||BigInt(row.sequence)!==BigInt(previous.sequence)+1n
   :row.sequence!=='1'||row.replacesVersionId!==null)return null;
 }
 return rows;
}
const fields=[['kind','Interval type'],['startedAt','Start'],['endedAt','End'],['pauseReason','Pause reason']] as const;
export function workIntervalChanges(previous:SavedWorkInterval|undefined,current:SavedWorkInterval){
 if(!previous||previous.intervalId!==current.intervalId||current.replacesVersionId!==previous.versionId||BigInt(previous.sequence)+1n!==BigInt(current.sequence))return null;
 return fields.filter(([key])=>previous[key]!==current[key]).map(([key,label])=>({key,label,before:previous[key],after:current[key]}));
}
