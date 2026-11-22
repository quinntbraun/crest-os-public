'use client';

import {useEffect,useRef} from 'react';
import Image from 'next/image';

export function WorkspaceRecovery({reset}:{reset:()=>void}){
 const heading=useRef<HTMLHeadingElement>(null);
 useEffect(()=>{heading.current?.focus();},[]);
 return <main className="workspace-missing">
  <section className="workspace-missing-card" aria-labelledby="recovery-title">
   <Image src="/brand/crest-detailing.png" width={56} height={56} alt=""/>
   <h1 id="recovery-title" ref={heading} tabIndex={-1}>This screen couldn’t open</h1>
   <p>Reload the screen to try again, or return to Today.</p>
   <p>If you were saving, check the original outcome in Save review before trying that action again.</p>
   <div className="workspace-missing-actions">
    <button type="button" onClick={reset}>Reload screen</button>
    <a className="primary-action secondary" href="/save-review">Review interrupted saves</a>
    <a href="/">Back to Today</a>
   </div>
  </section>
 </main>;
}
