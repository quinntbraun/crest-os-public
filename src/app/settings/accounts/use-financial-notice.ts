'use client';

import {useCallback,useState} from 'react';

// Confirmation comes from a verified command/lookup outcome, never message text.
export function useFinancialNotice(initialMessage:string){
 const [notice,setNotice]=useState({message:initialMessage,confirmed:false});
 const setMessage=useCallback((message:string,confirmed=false)=>setNotice({message,confirmed}),[]);
 const resetConfirmation=useCallback(()=>setNotice(current=>current.confirmed?{...current,confirmed:false}:current),[]);
 return {...notice,setMessage,resetConfirmation};
}
