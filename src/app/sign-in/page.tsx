import {SignIn} from './sign-in';
import Image from 'next/image';
import {originalOperationKinds} from '../../security/original-operation-reference';
import {readSignInReturn} from '../../client/sign-in-navigation';

export const dynamic='force-dynamic';
export const runtime='nodejs';
export default async function SignInPage({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){
 const params=await searchParams;
 const resumeKind=originalOperationKinds.find(kind=>kind===params.resumeSave)??null;
 const resume=resumeKind?{href:'/save-review?kind='+encodeURIComponent(resumeKind),label:'Return to interrupted save'}:
  readSignInReturn(params);
 return <main className="sign-in">
  <div className="sign-in-panel">
   <header className="sign-in-brand">
    <Image src="/brand/crest-detailing.png" width={192} height={192} priority alt="Crest Detailing"/>
    <div><p className="eyebrow">Crest OS</p><h1>Welcome back</h1></div>
   </header>
   <SignIn resume={resume}/>
  </div>
 </main>;
}
