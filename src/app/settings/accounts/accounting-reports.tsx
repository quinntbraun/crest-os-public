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
  {id:'ledger',label:'Ledger',available:true},
  {id:'income',label:'Income',available:recordedIncomeStatement},
  {id:'funds',label:'Customer funds',available:customerFundsReport},
  {id:'receivables',label:'Receivables',available:receivableAging},
 ] as const;
 const available=options.filter(option=>option.available);
 const current=available.find(option=>option.id===selected)??available[0]!;

 return <>
  {available.length>1&&<div className={styles.reportChoices} role="group" aria-label="Choose a report">
   {available.map(({id,label})=><button key={id} type="button" className="secondary"
    aria-pressed={current.id===id} aria-controls="accounting-report-view" onClick={()=>setSelected(id)}>{label}</button>)}
  </div>}
  <div className={styles.reports} id="accounting-report-view">
   {current.id==='ledger'&&<TrialBalance businessId={businessId}/>}
   {current.id==='income'&&<RecordedIncomeStatement businessId={businessId}/>}
   {current.id==='funds'&&<CustomerFundsReport businessId={businessId} includesExcess={context.excessReceipts===true}
    includesRefundTransfers={context.refundTransfers===true}/>}
   {current.id==='receivables'&&<ReceivableAging businessId={businessId}/>}
  </div>
 </>;
}
