'use client';
import Link from 'next/link';
import {useEffect,useRef,useState} from 'react';
import type {FormEvent} from 'react';
import {createBusinessSettingsController,initialSettingsView} from '../../client/business-settings-controller';
import {createPendingEditStore} from '../../client/pending-business-edit';
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
  return <section aria-label="Business name settings" aria-busy={view.busy}>
    <p ref={status} tabIndex={-1} role="status" aria-live="polite" aria-atomic="true">{view.message}</p>
    {view.phase==='ready'&&<><p className="current-name">Current name: <strong>{view.currentName}</strong></p><form onSubmit={submit}>
      <label htmlFor="business-name">Business legal name</label><input id="business-name" name="business-name" type="text" autoComplete="organization" maxLength={400} value={view.draft} onChange={event=>current.current?.edit(event.target.value)} aria-describedby="name-help" required disabled={view.busy}/>
      <p id="name-help" className="field-help">{[...view.draft].length}/200 characters. Use a nonempty name and review spelling and spacing. Currency, tax and other setup are not changed here.</p>
      <button type="submit" disabled={!view.canSave}>Save business name</button>
    </form></>}
    {view.phase==='pending'&&<><p className="field-help">Keep this tab’s pending record until the outcome is confirmed. Closing or clearing browser data may remove it.</p>
      {view.reference&&<p className="save-reference">Save reference: <code>{view.reference}</code></p>}
      <button type="button" disabled={view.busy} onClick={()=>void action('check')}>Check save status</button>
      {view.canRetry&&<button className="secondary" type="button" disabled={view.busy} onClick={()=>void action('retry')}>Retry original change</button>}
    </>}
    {['review','unavailable','blocked'].includes(view.phase)&&<button type="button" disabled={view.busy} onClick={()=>void action('load')}>Load current settings</button>}
    <nav aria-label="Settings navigation"><Link href="/sign-in">Device sign-in and sign-out</Link><Link href="/">Crest OS home</Link></nav>
    <p className="field-help">Customer and financial tools are still in setup. This screen does not activate production access.</p>
  </section>;
}
