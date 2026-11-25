import type {parseOpeningSourceHistory,OpeningSourceCursor} from '../../../bookkeeping/opening-source-history-contract';
import styles from './screen.module.css';
export type OpeningHistoryPage=ReturnType<typeof parseOpeningSourceHistory>;
export function OpeningSourceHistory({page,busy,label,onLoad,onSelect}:{page:OpeningHistoryPage|null;busy:boolean;label:string;onLoad:(cursor:OpeningSourceCursor|null)=>void;onSelect:(id:string)=>void}){
 return <div className={styles.openingGroup}><button type="button" className="secondary" disabled={busy} onClick={()=>onLoad(null)}>Browse saved {label}</button>
  {page&&<><p>Choose a saved review to inspect. Nothing is added or approved automatically.</p>{page.entries.length===0&&<p>No saved {label} were found.</p>}
   <ul>{page.entries.map(entry=><li key={entry.revisionId}><button type="button" className="secondary" disabled={busy} onClick={()=>onSelect(entry.revisionId)}>Worksheet {entry.worksheetRevision} · review {entry.revision} · {entry.itemCount} {label}<br/>Cutover {entry.cutoverOn} · saved {entry.recordedAt.slice(0,10)}</button></li>)}</ul>
   {page.nextCursor&&<button type="button" className="secondary" disabled={busy} onClick={()=>onLoad(page.nextCursor)}>Show older {label}</button>}
  </>}
 </div>;
}
