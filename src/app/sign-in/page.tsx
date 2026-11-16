import {SignIn} from './sign-in';
import Image from 'next/image';
export const dynamic='force-dynamic';
export const runtime='nodejs';
export default function SignInPage(){return <main className="sign-in"><div className="sign-in-brand"><Image src="/brand/crest-detailing.png" width={224} height={224} sizes="(min-width:900px) 120px, 96px" priority alt="Crest Detailing"/></div><div className="sign-in-panel"><h1>Crest OS</h1><p className="sign-in-intro">Access your Crest Detailing workspace.</p><SignIn/></div></main>;}
