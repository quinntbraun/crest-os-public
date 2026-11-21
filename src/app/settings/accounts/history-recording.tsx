import type {FinanceHistoryRecording} from '../../../bookkeeping/finance-history-recording';

const timestamp=new Intl.DateTimeFormat('en-US',{dateStyle:'medium',timeStyle:'long',timeZone:'UTC'});
export function FinanceHistoryRecordedTime({recording,inline=false}:{recording?:FinanceHistoryRecording|undefined;inline?:boolean}){
 if(!recording)return null;
 const Tag=inline?'span':'p';
 return <Tag className="financial-history-recorded">Recorded <time dateTime={recording.recordedAt}>{timestamp.format(new Date(recording.recordedAt))}</time></Tag>;
}
export function FinanceHistoryRecordingFacts({recording,auditEventId}:{recording?:FinanceHistoryRecording|undefined;auditEventId:string}){
 return <>
  <dl className="financial-history-evidence">
   {recording&&<><dt>Recorded in Crest (UTC)</dt><dd><time dateTime={recording.recordedAt}>{recording.recordedAt}</time></dd><dt>Recorded by reference</dt><dd>{recording.actorId}</dd></>}
   <dt>Audit event reference</dt><dd>{auditEventId}</dd>
  </dl>
  {!recording&&<p className="field-help">Recording time and the recording actor are not included in this history view.</p>}
 </>;
}
