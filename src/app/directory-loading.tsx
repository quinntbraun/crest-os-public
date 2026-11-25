export function DirectoryLoading({record=false}:{record?:boolean}){
 return <div className="directory-loading" data-record={record} aria-hidden="true">
  <div className="directory-loading-list"><span className="workspace-skeleton directory-loading-search"/>{[0,1,2].map(row=><div className="directory-loading-row" key={row}><span className="workspace-skeleton"/><span className="workspace-skeleton"/></div>)}</div>
  <div className="directory-loading-detail"><span className="workspace-skeleton directory-loading-title"/><span className="workspace-skeleton"/><span className="workspace-skeleton"/><span className="workspace-skeleton"/></div>
 </div>;
}
