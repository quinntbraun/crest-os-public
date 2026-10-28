'use client';
import {usePathname} from 'next/navigation';
import type {ReactNode} from 'react';

const destinations=[['/','Today'],['/customers','Customers'],['/vehicles','Vehicles'],['/leads','Leads']] as const;
// Document navigation preserves the editors' native unsaved-change warning.
export function WorkspaceFrame({children}:{children:ReactNode}){
  const path=usePathname();
  return <div className={path==='/sign-in'?'workspace sign-in-workspace':'workspace'}>
    <a className="skip-link" href="#workspace-content">Skip to content</a>
    <header className="workspace-header">
      <a className="crest-wordmark" href="/" aria-label="Crest OS home">CREST<span>OS</span></a>
      <p className="workspace-purpose">Detailing workspace</p>
      <details className="workspace-menu"><summary>Workspace</summary><nav aria-label="Workspace tools">
        <a href="/lead-sources">Lead sources</a><a href="/save-review">Interrupted saves</a><a href="/export-files">Data exports</a><a href="/settings">Business settings</a><a href="/sign-in">Sign in / sign out</a>
      </nav></details>
    </header>
    {path!=='/sign-in'&&<nav className="workspace-destinations" aria-label="Main navigation">{destinations.map(([href,label])=><a key={href} href={href} aria-current={path===href?'page':undefined}>{label}</a>)}</nav>}
    <div id="workspace-content" className="workspace-content" tabIndex={-1}>{children}</div>
  </div>;
}
