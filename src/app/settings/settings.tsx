'use client';
import {useEffect,useId,useRef,useState} from 'react';
import type {FormEvent} from 'react';
import {createBusinessSettingsController,initialSettingsView} from '../../client/business-settings-controller';
import {createPendingEditStore} from '../../client/pending-business-edit';
function SettingsLink({href,label,description}:{href:string;label:string;description:string}){
  const id=useId();
  return <li>
    <a href={href} aria-describedby={id}>{label}</a>
    <p id={id}>{description}</p>
  </li>;
}

export function BusinessSettingsScreen(){
  const [view,setView]=useState(initialSettingsView),current=useRef<ReturnType<typeof createBusinessSettingsController>|null>(null),status=useRef<HTMLParagraphElement>(null);
  useEffect(()=>{
    const controller=createBusinessSettingsController({store:createPendingEditStore({getItem:key=>sessionStorage.getItem(key),setItem:(key,value)=>sessionStorage.setItem(key,value),removeItem:key=>sessionStorage.removeItem(key)}),change:setView});
    current.current=controller;void controller.load();const returned=()=>{if(document.visibilityState==='visible')controller.reviewOnReturn();};
    window.addEventListener('focus',returned);window.addEventListener('pageshow',returned);document.addEventListener('visibilitychange',returned);
    return ()=>{controller.dispose();current.current=null;window.removeEventListener('focus',returned);window.removeEventListener('pageshow',returned);document.removeEventListener('visibilitychange',returned);};
  },[]);
  async function action(kind:'load'|'save'|'check'|'retry'){
    const controller=current.current;if(!controller)return;await controller[kind]();if(current.current===controller)status.current?.focus();
  }
  function submit(event:FormEvent){event.preventDefault();void action('save');}
  return <div className="settings-layout">
    <section className="settings-card settings-identity" aria-labelledby="business-name-heading" aria-busy={view.busy}>
    <h2 id="business-name-heading">Business identity</h2>
    <p className="settings-feedback" ref={status} tabIndex={-1} role="status" aria-live="polite" aria-atomic="true">{view.message}</p>
    {view.phase==='loading'&&<div className="settings-loading" aria-hidden="true">
      <span className="workspace-skeleton"/><span className="workspace-skeleton"/>
    </div>}
    {view.phase==='ready'&&<><p className="current-name"><span>Saved legal name</span><strong>{view.currentName}</strong></p><form onSubmit={submit}>
      <label htmlFor="business-name">Business legal name</label><input id="business-name" name="business-name" type="text" autoComplete="organization" maxLength={400} value={view.draft} onChange={event=>current.current?.edit(event.target.value)} aria-describedby="name-help" required disabled={view.busy}/>
      <p id="name-help" className="field-help">{[...view.draft].length}/200 characters. Enter the legal name exactly as registered.</p>
      <button type="submit" disabled={!view.canSave}>Save business name</button>
    </form></>}
    {view.phase==='pending'&&<><p className="field-help">Keep this tab’s pending record until the outcome is confirmed. Closing or clearing browser data may remove it.</p>
      {view.reference&&<details className="settings-save-reference"><summary>Save reference</summary><p className="save-reference"><code>{view.reference}</code></p></details>}
      <button type="button" disabled={view.busy} onClick={()=>void action('check')}>Check save status</button>
      {view.canRetry&&<button className="secondary" type="button" disabled={view.busy} onClick={()=>void action('retry')}>Retry original change</button>}
    </>}
    {['review','unavailable','blocked'].includes(view.phase)&&<button type="button" disabled={view.busy} onClick={()=>void action('load')}>Load current settings</button>}
    </section>
    <nav className="settings-directory" aria-label="Settings navigation">
      {(view.financeAccountsAvailable||view.syntheticCalendarAvailable)&&<section className="settings-card" aria-labelledby="settings-operations">
        <h2 id="settings-operations">Business tools</h2>
        <ul className="settings-links">
          {view.syntheticCalendarAvailable&&<SettingsLink href="/settings/google-calendar" label="Google Calendar setup" description="Review the simulated calendar and choose which event details Crest shares."/>}
          {view.financeAccountsAvailable&&<SettingsLink href="/settings/accounts" label="Fictional account setup" description="Review the chart of accounts, financial reports, and posting settings."/>}
        </ul>
      </section>}
      <section className="settings-card" aria-labelledby="settings-data">
        <h2 id="settings-data">Data and recovery</h2>
        <ul className="settings-links">
          <SettingsLink href="/export-files" label="Business data exports" description="Prepare a copy of business records or download posted finance reports."/>
          <SettingsLink href="/save-review" label="Review interrupted save" description="Check the original outcome of a save in this tab."/>
        </ul>
      </section>
      <section className="settings-card" aria-labelledby="settings-access">
        <h2 id="settings-access">Device access</h2>
        <ul className="settings-links">
          <SettingsLink href="/sign-in" label="Device sign-in and sign-out" description="Check the current session or manage access on this device."/>
        </ul>
      </section>
    </nav>
  </div>;
}
