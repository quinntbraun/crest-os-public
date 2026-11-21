'use client';

import {useLayoutEffect,useRef} from 'react';
import type {ReactNode} from 'react';
import styles from './screen.module.css';

export function ReportReadingSummary({snapshot,children}:{snapshot:object|null;children:ReactNode}){
 const reading=useRef<HTMLDivElement>(null);
 useLayoutEffect(()=>{
  if(!snapshot||document.visibilityState==='hidden')return;
  const heading=reading.current?.querySelector<HTMLElement>('header');
  if(heading?.getClientRects().length){heading.focus({preventScroll:true});heading.scrollIntoView({block:'start',behavior:'instant'});}
 },[snapshot]);
 // Contents layout keeps the scope title sticky within the complete report.
 // The wrapper stays mounted so arriving data does not replace date controls.
 return <div ref={reading} className={styles.reportReading} data-report-reading hidden={!snapshot}>{snapshot?children:null}</div>;
}
