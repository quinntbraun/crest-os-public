'use client';

import {useState} from 'react';
import type {FinanceAccountContext} from '../../../client/finance-accounts';
import {CustomerFundsReport} from './customer-funds-report';
import {ReceivableAging} from './receivable-aging';
import {RecordedIncomeStatement} from './recorded-income-statement';
import {TrialBalance} from './trial-balance';
import styles from './screen.module.css';

type Report = 'ledger' | 'income' | 'funds' | 'receivables';

export function AccountingReports({context}:{context:FinanceAccountContext}){
 const [selected,setSelected]=useState<Report>('ledger');
 const {businessId,recordedIncomeStatement,customerFundsReport,receivableAging}=context;
 const options=[
  {id:'ledger',label:'Ledger',description:'Posted balances and journal entries',available:true},
  {id:'income',label:'Income',description:'Recorded income and expenses',available:recordedIncomeStatement},
  {id:'funds',label:'Customer funds',description:'Recorded funds held for customers',available:customerFundsReport},
  {id:'receivables',label:'Receivables',description:'Outstanding posted invoices by age',available:receivableAging},
 ] as const;
 const available=options.filter(option=>option.available);
 const current=available.find(option=>option.id===selected)??available[0]!;

 return <div className={styles.reportWorkspace} data-picker={available.length>1}>
  {available.length>1&&<nav className={styles.reportPicker} aria-label="Report navigation">
   <p className={styles.reportPickerTitle}>Report library</p>
   <div className={styles.reportChoices} role="group" aria-label="Choose a report">
   {available.map(({id,label,description})=><div key={id} className={styles.reportChoice}>
    <button type="button" className="secondary" aria-describedby={'accounting-report-description-'+id}
     aria-pressed={current.id===id} aria-controls="accounting-report-view" onClick={()=>setSelected(id)}>{label}</button>
    <small id={'accounting-report-description-'+id}>{description}</small>
   </div>)}
   </div>
   <p className={styles.reportPickerHelp}>Load a report's dates to see checked figures and its recorded coverage.</p>
  </nav>}
  <div className={styles.reports} id="accounting-report-view">
   {current.id==='ledger'&&<TrialBalance businessId={businessId}/>}
   {current.id==='income'&&<RecordedIncomeStatement businessId={businessId}/>}
   {current.id==='funds'&&<CustomerFundsReport businessId={businessId} includesExcess={context.excessReceipts===true}
    includesRefundTransfers={context.refundTransfers===true}/>}
   {current.id==='receivables'&&<ReceivableAging businessId={businessId}/>}
  </div>
 </div>;
}
