'use client';

import {WorkspaceRecovery} from './workspace-recovery';
import type {ComponentType} from 'react';
import type {WorkspaceRecoveryBoundaryProps} from './workspace-recovery';

// A fresh document also replaces a failed server-component result.
const ErrorScreen:ComponentType<WorkspaceRecoveryBoundaryProps>=()=>
 <WorkspaceRecovery reset={()=>window.location.reload()}/>;
export default ErrorScreen;
