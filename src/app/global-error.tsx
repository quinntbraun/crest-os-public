'use client';

import './globals.css';
import './workspace-design.css';
import {WorkspaceRecovery} from './workspace-recovery';
import type {ComponentType} from 'react';
import type {WorkspaceRecoveryBoundaryProps} from './workspace-recovery';

const GlobalErrorScreen:ComponentType<WorkspaceRecoveryBoundaryProps>=()=>
 <html lang="en"><head>
  <meta charSet="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <meta name="robots" content="noindex, nofollow"/>
  <title>Screen recovery · Crest OS</title>
 </head><body><WorkspaceRecovery reset={()=>window.location.reload()}/></body></html>;
export default GlobalErrorScreen;
