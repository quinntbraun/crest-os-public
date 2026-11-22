'use client';

import {useSyncExternalStore} from 'react';
import type {ComponentProps} from 'react';
import {signInHrefForPath} from '../client/sign-in-navigation';
import type {SignInDestination} from '../client/sign-in-navigation';

const subscribe=(notify:()=>void)=>{
 window.addEventListener('popstate',notify);
 return()=>window.removeEventListener('popstate',notify);
};
export function SignInLink({returnTo,context,...props}:Omit<ComponentProps<'a'>,'href'>&{returnTo?:SignInDestination;context?:Readonly<Record<string,unknown>>}){
 const href=useSyncExternalStore(subscribe,()=>{
  const input:Record<string,unknown>=Object.create(null),params=new URLSearchParams(window.location.search);
  for(const name of new Set(params.keys())){
   const values=params.getAll(name);input[name]=values.length===1?values[0]:values;
  }
  return signInHrefForPath(window.location.pathname,{...input,...context},returnTo);
 },()=>signInHrefForPath('',{},returnTo));
 return <a {...props} href={href}/>;
}
