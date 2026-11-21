const introductions={
 customer:{title:'Choose a customer',description:'Open a saved customer to review contact details, linked vehicles and retained history.',action:'Find a customer',label:'Customer directory introduction'},
 vehicle:{title:'Choose a vehicle',description:'Open a saved vehicle to review its details, customer links and retained history.',action:'Find a vehicle',label:'Vehicle directory introduction'},
 service:{title:'Choose a service',description:'Open a saved service to review included work, price guidance and revision history.',action:'Find a service',label:'Service directory introduction'},
 source:{title:'Choose a lead source',description:'Review how a source is classified, its referring customer link and retained changes.',action:'Find a lead source',label:'Lead source directory introduction'},
} as const;

export function DirectoryIntroduction({kind,onSearch}:{kind:keyof typeof introductions;onSearch:()=>void}){
 const content=introductions[kind];
 return <section className="directory-introduction" aria-label={content.label}>
  <span className="directory-introduction-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" focusable="false"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M11 4v16M6 8h2M6 12h2M6 16h2M14 9h4M14 13h3"/></svg></span>
  <h2>{content.title}</h2>
  <p>{content.description}</p>
  <p>Choose a record from the list, or search for the one you need.</p>
  <button type="button" className="secondary" onClick={onSearch}>{content.action}</button>
 </section>;
}
