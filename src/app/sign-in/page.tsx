import {SignIn} from './sign-in';
import Image from 'next/image';
import {customerUuid} from '../../customer/customer-contract';
import {originalOperationKinds} from '../../security/original-operation-reference';
const destinations=[
 ['schedule','/schedule','Return to Schedule'],
 ['customers','/customers','Return to Customers'],
 ['leads','/leads','Return to Leads'],
 ['quotes','/quotes','Return to Quotes'],
 ['expenses','/expenses','Return to Expenses'],
 ['contact-import','/customers/import-review','Return to contact import'],
] as const;

export const dynamic='force-dynamic';
export const runtime='nodejs';
export default async function SignInPage({searchParams}:{searchParams:Promise<{resumeSave?:string|string[];returnTo?:string|string[];job?:string|string[]}>}){
 const {resumeSave,returnTo,job}=await searchParams;
 const resumeKind=originalOperationKinds.find(kind=>kind===resumeSave)??null;
 const destination=destinations.find(([key])=>key===returnTo);
 const resume=resumeKind?{href:'/save-review?kind='+encodeURIComponent(resumeKind),label:'Return to interrupted save'}:
  returnTo==='schedule'&&customerUuid(job)?{href:'/schedule?job='+encodeURIComponent(job),label:'Return to saved job'}:
  destination?{href:destination[1],label:destination[2]}:null;
 return <main className="sign-in">
  <div className="sign-in-panel">
   <header className="sign-in-brand">
    <Image src="/brand/crest-detailing.png" width={56} height={56} priority alt="Crest Detailing"/>
    <div><p className="eyebrow">Crest OS</p><h1>Welcome back</h1></div>
   </header>
   <SignIn resume={resume}/>
  </div>
 </main>;
}
