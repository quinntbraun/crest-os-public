import type {ReactNode} from 'react';
import styles from './screen.module.css';

function snapshotTime(observedAt:string,timeZone:string){
 try{return new Intl.DateTimeFormat('en-US',{dateStyle:'medium',timeStyle:'medium',timeZone}).format(new Date(observedAt));}
 catch{return observedAt;}
}

export function FinancialReportHeader({period,timeZone,observedAt,scopeLabel,coverage,basis,details,action}:{
 period:ReactNode;timeZone:string;observedAt:string;
 scopeLabel:'Coverage incomplete'|'Posted customer funds'|'Posted invoices';
 coverage:string;basis?:ReactNode;details?:ReactNode;action?:ReactNode;
}){
 return <>
  <header className={styles.reportHeaderTitle} tabIndex={-1}>
   <p className={styles.reportPeriod}>{period}</p>
   <span className={styles.reportScopeLabel} data-incomplete={scopeLabel==='Coverage incomplete'}>{scopeLabel}</span>
  </header>
  <div className={styles.reportHeader}>
  <div className={styles.reportSnapshot}>
   <div className={styles.reportSnapshotFacts}>
    <p>USD · {timeZone}</p>
    <p className="field-help">Snapshot checked <time dateTime={observedAt} title={observedAt}>{snapshotTime(observedAt,timeZone)}</time></p>
    {details}
   </div>
   {action}
  </div>
  <p className={styles.reportCoverage}>{coverage}</p>
  {basis&&<p className={styles.reportBasis}>{basis}</p>}
  </div>
 </>;
}
