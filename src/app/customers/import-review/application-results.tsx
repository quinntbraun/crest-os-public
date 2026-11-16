'use client';

import {useEffect,useRef} from 'react';
import type {legacyBatches} from '../../../client/customers';

export type ApplicationReceipt=Exclude<Awaited<ReturnType<typeof legacyBatches.apply>>,{state:'conflict'}>['receipt'];
export type ApplicationPage=Exclude<Awaited<ReturnType<typeof legacyBatches.application>>,{state:'absent'}>;
const number=new Intl.NumberFormat('en-US');
const actions={create:'Created',link:'Linked existing',skip:'Skipped',none:'None in file'};

export function ApplicationResults({receipt,page,busy,previous,next,retry,focusOnLoad=true,download}:{
 receipt:ApplicationReceipt;page:ApplicationPage|null;busy:boolean;previous:(()=>void)|undefined;next:(()=>void)|undefined;retry:()=>void;focusOnLoad?:boolean;download:(()=>void)|undefined;
}){
 const heading=useRef<HTMLHeadingElement>(null);
 useEffect(()=>{if(focusOnLoad)heading.current?.focus();},[page,focusOnLoad]);
 return <section className="legacy-application-results" aria-label="Import results">
  <h4 tabIndex={-1} ref={heading}>Import completed</h4>
  <dl className="legacy-effect-counts">
   <div><dt>Customers created</dt><dd>{number.format(receipt.customersCreated)}</dd></div>
   <div><dt>Vehicles created</dt><dd>{number.format(receipt.vehiclesCreated)}</dd></div>
   <div><dt>Rows skipped</dt><dd>{number.format(receipt.skippedRows)}</dd></div>
  </dl>
  {receipt.rowsWithVehiclePair>0&&<p className="field-help">Vehicle pairs are recorded in these results. Set ownership, keeper and billing details in Vehicles.</p>}
  <p className="legacy-application-reference">Receipt {receipt.operationId}</p>
  {download&&<button type="button" className="secondary" disabled={busy} onClick={download}>Download import history</button>}
  {page?<><table className="legacy-approval-counts">
   <caption className="visually-hidden">Import outcomes by CSV row</caption>
   <thead><tr><th scope="col">Record</th><th scope="col">Customer</th><th scope="col">Vehicle</th></tr></thead>
   <tbody>{page.rows.map(row=><tr key={row.row}>
    <th scope="row">{number.format(row.row)}</th><td>{actions[row.customerAction]}</td>
    <td>{row.vehicleId?<a href={'/vehicles?vehicle='+encodeURIComponent(row.vehicleId)}
     aria-label={actions[row.vehicleAction]+' vehicle from record '+row.row}>{actions[row.vehicleAction]}</a>:
     row.customerAction==='skip'?'—':actions[row.vehicleAction]}</td>
   </tr>)}</tbody>
  </table>
  {(previous||next)&&<nav className="legacy-pagination" aria-label="Import result pages">
   <button type="button" className="secondary" disabled={busy||!previous} onClick={previous}>Previous results</button>
   <button type="button" className="secondary" disabled={busy||!next} onClick={next}>Next results</button>
  </nav>}
  </>:<button type="button" className="secondary" disabled={busy} onClick={retry}>Load row results</button>}
 </section>;
}
