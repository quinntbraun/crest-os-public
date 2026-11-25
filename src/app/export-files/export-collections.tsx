'use client';
import {useCallback,useLayoutEffect,useRef,useState} from 'react';
import {SourceExportScreen} from './export-files';
import {PostedFinanceExport} from './posted-finance-export';
import {SignInLink} from '../sign-in-link';

export function ExportCollections(){
 const [accessChanged,setAccessChanged]=useState(false),[rechecking,setRechecking]=useState(false),notice=useRef<HTMLParagraphElement>(null);
 const onAccessDenied=useCallback(()=>setAccessChanged(true),[]);
 useLayoutEffect(()=>{if(accessChanged)notice.current?.focus();},[accessChanged]);
 return <div className="export-collections">
  {accessChanged?<section className="export-files" aria-label="Export access recovery">
   <h2>Check export access</h2>
   <p className="export-status" role="status" tabIndex={-1} ref={notice}>Export access changed. Loaded package and report details were cleared. Sign in or check access again; saved request references have been kept.</p>
   <nav className="actions" aria-label="Export recovery actions">
    <SignInLink className="primary-action" returnTo="exports">Sign in again</SignInLink>
    <button type="button" className="secondary" onClick={()=>{setRechecking(true);setAccessChanged(false);}}>Check export access</button>
   </nav>
  </section>:<><PostedFinanceExport onAccessDenied={onAccessDenied}/><SourceExportScreen onAccessDenied={onAccessDenied} focusOnLoad={rechecking}/></>}
 </div>;
}
