import {SignIn} from './sign-in';
import Image from 'next/image';
export const dynamic='force-dynamic';
export const runtime='nodejs';
export default function SignInPage(){return <main className="sign-in"><div className="sign-in-brand"><Image src="/brand/crest-detailing.png" width={224} height={224} sizes="(max-width:600px) 112px, 224px" priority alt="Crest Detailing"/></div><div className="sign-in-panel"><h1>Crest OS</h1><p className="sign-in-intro">Your detailing workspace.</p><SignIn/></div></main>;}
