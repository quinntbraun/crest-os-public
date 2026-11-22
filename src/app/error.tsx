'use client';

import {WorkspaceRecovery} from './workspace-recovery';

export default function ErrorScreen({reset}:{error:Error&{digest?:string};reset:()=>void}){
 return <WorkspaceRecovery reset={reset}/>;
}
