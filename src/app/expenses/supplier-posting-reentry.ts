'use client';
import {createContext} from 'react';
import type {PendingSupplierPosting} from '../../client/pending-supplier-posting';

// Granted only by an explicit lookup returning absent in the current verified
// workspace. This supplies an original identity, never a private write payload.
export const SupplierPostingReentry=createContext<{reentry:PendingSupplierPosting|null;onResolved:()=>void;onAccessDenied:()=>void}|null>(null);
