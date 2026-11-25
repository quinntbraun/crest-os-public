export type ImportStage='source'|'review'|'approve'|'results';
export type ImportReviewState={batchId:string;revision:number;stage:ImportStage;undecided:number|null;applicationPending:boolean};
const importStages=[['source','Source'],['review','Review'],['approve','Approve'],['results','Results']] as const;
export function ImportStages({stage}:{stage:ImportStage}){
 const current=importStages.findIndex(([key])=>key===stage);
 return <ol className="legacy-import-stages" aria-label="Import progress">
  {importStages.map(([key,label],index)=><li key={key} aria-current={index===current?'step':undefined} data-stage={index<current?'complete':index===current?'current':'upcoming'}>
   <span aria-hidden="true">{index<current?'✓':index+1}</span>{label}{index<current&&<span className="visually-hidden"> complete</span>}
  </li>)}
 </ol>;
}
