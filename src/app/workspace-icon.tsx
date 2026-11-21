type WorkspaceIconName='today'|'customers'|'schedule'|'leads'|'quotes';

// A small, consistent navigation set keeps shape and weight independent of the
// platform's text fonts. Destination labels remain the accessible link names.
export function WorkspaceIcon({name}:{name:WorkspaceIconName}){
 return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
  {name==='today'&&<><path d="m3 10 9-7 9 7"/><path d="M5 9v11h5v-6h4v6h5V9"/></>}
  {name==='customers'&&<><circle cx="9" cy="8" r="3"/><path d="M3 20v-2a6 6 0 0 1 12 0v2M16 5a3 3 0 0 1 0 6M18 14a5 5 0 0 1 3 4v2"/></>}
  {name==='schedule'&&<><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4M17 3v4M3 11h18M8 15h2M14 15h2M8 18h2"/></>}
  {name==='leads'&&<><circle cx="9" cy="8" r="3"/><path d="M3 20v-2a6 6 0 0 1 12 0v2M19 7v6M16 10h6"/></>}
  {name==='quotes'&&<><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M8 13h8M8 17h5"/></>}
 </svg>;
}
