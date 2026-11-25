'use client';

import {SignInLink} from './sign-in-link';
import type {SignInDestination} from '../client/sign-in-navigation';

export function FinancialAccessRecovery({returnTo,label,customerId}:{returnTo:SignInDestination;label:string;customerId?:string}){
 return <nav className="actions" aria-label={label}>
  <SignInLink className="primary-action" returnTo={returnTo} context={returnTo==='customers'&&customerId?{customer:customerId,view:'payments'}:returnTo==='accounting'?{view:'reports'}:{}}>Sign in again</SignInLink>
  <a className="record-return-link" href="/save-review">Review interrupted saves</a>
 </nav>;
}
