'use client';
import {usePathname} from 'next/navigation';
import type {ReactNode} from 'react';

const destinations=[['/','Today'],['/customers','Customers'],['/schedule','Schedule'],['/leads','Leads'],['/quotes','Quotes']] as const;
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

// Document navigation preserves the editors' native unsaved-change warning.
export function WorkspaceFrame({children}:{children:ReactNode}){
  const path=usePathname();
  return <div className={path==='/sign-in'?'workspace sign-in-workspace':'workspace'}>
    <a className="skip-link" href="#workspace-content">Skip to content</a>
    <header className="workspace-masthead"><div className="workspace-header">
      <a className="crest-wordmark" href="/" aria-label="Crest OS home">CREST <span>OS</span></a>
      <p className="workspace-purpose">Detailing workspace</p>
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
              <a href={href} aria-current={path===href||href==='/settings/accounts'&&path.startsWith(href+'/')?'page':undefined}>{name}</a>
            </li>)}</ul>
          </div>)}
        </nav>
      </details>
    </div>
    <p className="workspace-test-notice">Test workspace · Use fictional records only</p>
    </header>
    {path!=='/sign-in'&&<nav className="workspace-destinations" aria-label="Main navigation">{destinations.map(([href,label])=><a key={href} href={href} aria-current={path===href||href!=='/'&&path.startsWith(href+'/')?'page':undefined}>{label}</a>)}</nav>}
    <div id="workspace-content" className="workspace-content" tabIndex={-1}>{children}</div>
  </div>;
}
