'use client';
import {usePathname} from 'next/navigation';
import {useCallback,useEffect,useRef,useState} from 'react';
import type {FocusEvent,ReactNode} from 'react';

const destinations=[
  ['/','Today','◈'],['/customers','Customers','◎'],['/schedule','Schedule','▦'],['/leads','Leads','◇'],['/quotes','Quotes','≡'],
] as const;
const tools=[
  {label:'Jobs and customers',links:[
    ['/vehicles','Vehicles'],
    ['/appointment-holds','Appointment proposals'],
    ['/services','Services'],
    ['/lead-sources','Lead sources'],
  ]},
  {label:'Money',links:[
    ['/expenses','Expenses'],
    ['/settings/accounts','Accounting'],
  ]},
  {label:'Workspace settings',links:[
    ['/settings','Business settings'],
    ['/export-files','Data exports'],
    ['/save-review','Interrupted saves'],
    ['/sign-in','Sign in / sign out'],
  ]},
] as const;
const routes=[...destinations.map(([href,name])=>({href,name,group:'Main navigation'})),
  ...tools.flatMap(({label,links})=>links.map(([href,name])=>({href,name,group:label})))];
const searchTerms:Record<string,string>={
  '/':'home dashboard', '/schedule':'calendar appointments jobs mileage travel pictures photos', '/leads':'prospects follow up',
  '/quotes':'estimate proposals', '/customers':'clients contacts address payments invoices', '/settings/accounts':'finance books ledger reconciliation reports',
  '/expenses':'receipts supplier bills payables purchases', '/export-files':'csv downloads portability',
  '/save-review':'recovery pending failed saves', '/vehicles':'cars trucks',
};
const isCurrent=(path:string,href:string)=>path===href||href!=='/'&&href!=='/settings'&&path.startsWith(href+'/');

function WorkspaceSearch(){
  const dialog=useRef<HTMLDialogElement>(null),trigger=useRef<HTMLButtonElement>(null),input=useRef<HTMLInputElement>(null);
  const returnFocus=useRef<HTMLElement|null>(null);
  const [query,setQuery]=useState('');
  const open=useCallback((opener?:HTMLElement)=>{
    if(!dialog.current||dialog.current.open)return;
    const active=document.activeElement;
    returnFocus.current=opener??(active instanceof HTMLElement&&(active.tabIndex>=0||active.isContentEditable)?active:trigger.current);
    setQuery('');
    dialog.current.showModal();
    input.current?.focus();
  },[]);
  useEffect(()=>{
    const shortcut=(event:KeyboardEvent)=>{
      if(event.defaultPrevented||event.repeat||event.altKey||event.shiftKey||event.key.toLowerCase()!=='k'||!(event.ctrlKey||event.metaKey))return;
      if(document.querySelector('dialog[open]')&&!dialog.current?.open)return;
      event.preventDefault();
      open();
    };
    window.addEventListener('keydown',shortcut);
    return ()=>window.removeEventListener('keydown',shortcut);
  },[open]);
  function restoreFocus(){
    const target=returnFocus.current;
    returnFocus.current=null;
    if(target?.isConnected)target.focus({preventScroll:true});
    if(document.activeElement!==target)trigger.current?.focus({preventScroll:true});
  }

  const search=query.toLowerCase().trim().replace(/\s+/g,' ');
  const terms=search.split(' ');
  function priority(name:string){
    const label=name.toLowerCase();
    if(label===search)return 0;
    if(label.startsWith(search))return 1;
    if(terms.every(term=>label.includes(term)))return 2;
    return 3;
  }
  const results=routes.filter(({href,name,group})=>terms.every(term=>
    (name+' '+group+' '+(searchTerms[href]??'')).toLowerCase().includes(term)))
    .sort((left,right)=>priority(left.name)-priority(right.name));
  return <>
    <button type="button" className="workspace-search-toggle" aria-haspopup="dialog" aria-keyshortcuts="Control+K Meta+K" onClick={event=>open(event.currentTarget)} ref={trigger}>
      <span className="workspace-search-icon" aria-hidden="true"/><span className="workspace-search-text">Find a tool</span><kbd aria-hidden="true">Ctrl K</kbd>
    </button>
    <dialog className="workspace-search" ref={dialog} aria-labelledby="workspace-search-title" onClose={restoreFocus}
      onKeyDown={event=>{
        if(event.key==='Escape'){event.preventDefault();event.currentTarget.close();return;}
        if(!(event.target instanceof HTMLAnchorElement)||!['ArrowDown','ArrowUp','Home','End'].includes(event.key))return;
        const links=Array.from(event.currentTarget.querySelectorAll<HTMLAnchorElement>('li a'));
        const index=links.indexOf(event.target);
        if(index===-1)return;
        event.preventDefault();
        if(event.key==='Home'){links[0]?.focus();return;}
        if(event.key==='End'){links.at(-1)?.focus();return;}
        if(event.key==='ArrowUp'&&index===0){input.current?.focus();return;}
        links[index+(event.key==='ArrowDown'?1:-1)]?.focus();
      }}
      onClick={event=>{if(event.target===event.currentTarget)event.currentTarget.close();}}>
      <div className="workspace-search-inner">
        <div className="workspace-search-heading"><h2 id="workspace-search-title">Find a tool</h2>
          <button type="button" className="secondary" aria-label="Close tool search" onClick={()=>dialog.current?.close()}>×</button>
        </div>
        <label htmlFor="workspace-tool-query" className="visually-hidden">Search workspace tools</label>
        <input id="workspace-tool-query" ref={input} type="search" autoComplete="off" placeholder="Try receipts, quotes, or calendar" value={query} onChange={event=>setQuery(event.target.value)}
          onKeyDown={event=>{
            if(event.nativeEvent.isComposing||event.key!=='ArrowDown'&&event.key!=='Enter')return;
            const first=dialog.current?.querySelector<HTMLAnchorElement>('li a');
            if(!first)return;
            event.preventDefault();
            if(event.key==='ArrowDown')first.focus();
            else first.click();
          }}/>
        <ul aria-label="Matching tools">{results.map(({href,name,group})=><li key={href}>
          <a href={href}><span>{name}</span><small>{group}</small><span aria-hidden="true">↗</span></a>
        </li>)}</ul>
        {results.length===0&&<p aria-live="polite">No tools match that search.</p>}
      </div>
    </dialog>
  </>;
}

// Document navigation preserves the editors' native unsaved-change warning.
export function WorkspaceFrame({children}:{children:ReactNode}){
  const path=usePathname(),signIn=path==='/sign-in';
  const navigation=useRef<HTMLElement>(null);

  function keepFocusAboveNavigation(event:FocusEvent<HTMLDivElement>){
    const element=event.target,nav=navigation.current;
    if(element===event.currentTarget||!nav||!element.matches(':focus-visible')||getComputedStyle(nav).position!=='fixed')return;
    // WebKit can leave a focused control behind a fixed bar when it already fits in the viewport.
    requestAnimationFrame(()=>{
      if(document.activeElement!==element||!nav.isConnected)return;
      const {bottom,height}=element.getBoundingClientRect(),boundary=nav.getBoundingClientRect().top;
      if(bottom>boundary&&height<boundary)element.scrollIntoView({block:'nearest',inline:'nearest',behavior:'instant'});
    });
  }

  return <div className={signIn?'workspace sign-in-workspace':'workspace'}>
    <a className="skip-link" href="#workspace-content">Skip to content</a>
    <header className="workspace-masthead"><div className="workspace-header">
      <a className="crest-wordmark" href="/" aria-label="Crest OS home"><i className="crest-symbol" aria-hidden="true"/>CREST <span>OS</span></a>
      <p className="workspace-purpose">Crest Detailing</p>
      {!signIn&&<WorkspaceSearch/>}
      <details className="workspace-menu" onKeyDown={event=>{
        if(event.key!=='Escape'||!event.currentTarget.open)return;
        event.preventDefault();
        event.currentTarget.open=false;
        event.currentTarget.querySelector('summary')?.focus();
      }}>
        <summary>Workspace</summary>
        <nav aria-label="Workspace tools">
          {tools.map(({label,links})=><div className="workspace-menu-group" key={label}>
            <p>{label}</p>
            <ul>{links.map(([href,name])=><li key={href}>
              <a href={href} aria-current={isCurrent(path,href)?'page':undefined}>{name}</a>
            </li>)}</ul>
          </div>)}
        </nav>
      </details>
    </div>
    <p className="workspace-test-notice"><i aria-hidden="true"/>Test workspace · Use fictional records only</p>
    </header>
    {!signIn&&<nav ref={navigation} className="workspace-destinations" aria-label="Main navigation">{destinations.map(([href,label,icon])=>
      <a key={href} href={href} aria-current={isCurrent(path,href)?'page':undefined}><span className="destination-glyph" aria-hidden="true">{icon}</span>{label}</a>)}</nav>}
    <div id="workspace-content" className="workspace-content" tabIndex={-1} onFocus={keepFocusAboveNavigation}>{children}</div>
  </div>;
}
