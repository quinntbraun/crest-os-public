import type {LoadedJobWorkTime} from './job-work-time-contract';

const columns=['jobId','jobVersion','observedAt','intervalId','versionId','sequence','current','replacesVersionId',
 'changeKind','recordedAt','kind','startedAt','endedAt','pauseReason','recordReason'] as const;
function cell(value:string|null){
 if(value===null)return '""';
 const safe=/^\s*[=+@-]/.test(value)||value.startsWith("'")?"'"+value:value;
 return '"'+safe.replaceAll('"','""')+'"';
}

export function formatJobWorkTimeCsv({record,intervals}:LoadedJobWorkTime){
 const current=new Set(intervals.map(interval=>interval.versionId));
 const lines=record.intervalVersions.map(interval=>{
  const row={jobId:record.jobId,jobVersion:record.jobVersion,observedAt:record.observedAt,
   current:current.has(interval.versionId)?'true':'false',...interval};
  return columns.map(column=>cell(row[column])).join(',');
 });
 return [columns.join(','),...lines].join('\r\n')+'\r\n';
}
