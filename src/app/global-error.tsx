'use client';

import './globals.css';
import './workspace-design.css';
import {WorkspaceRecovery} from './workspace-recovery';

export default function GlobalErrorScreen({reset}:{error:Error&{digest?:string};reset:()=>void}){
 return <html lang="en"><body><WorkspaceRecovery reset={reset}/></body></html>;
}
