'use client';
export function DirectoryRecall({label,disabled,onReopen}:{label:string;disabled:boolean;onReopen:(button:HTMLButtonElement)=>void}){
 return <div className="notice"><p>Your record selection has been kept. Private details will be checked again.</p>
  <button type="button" className="secondary" disabled={disabled} onClick={event=>onReopen(event.currentTarget)}>Reopen selected {label}</button>
 </div>;
}
