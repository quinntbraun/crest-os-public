import Image from 'next/image';
import {WorkspaceToolSearchButton} from './workspace-frame';

export default function NotFound(){
 return <main className="workspace-missing">
  <section className="workspace-missing-card" aria-labelledby="missing-title">
   <Image src="/brand/crest-detailing.png" width={56} height={56} alt=""/>
   <h1 id="missing-title">Page not found</h1>
   <p>Check the address, return to Today, or find a tool to get back to your work.</p>
   <div className="workspace-missing-actions">
    <a className="primary-action" href="/">Back to Today</a>
    <WorkspaceToolSearchButton className="secondary"/>
   </div>
  </section>
 </main>;
}
