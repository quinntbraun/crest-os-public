'use client';
import {useState} from 'react';
import {phonePresentation} from '../../client/phone-presentation';
export function PhoneInput({name,value,limit,change}:{name:string;value:string;limit:number;change:(value:string)=>void}){
 const [editing,setEditing]=useState(false);
 return <><label className="visually-hidden" htmlFor={name}>Phone value</label><input id={name} name={name} type="tel" inputMode="tel" autoComplete="tel" placeholder="+1 (555) 555-0123" maxLength={limit*2} value={editing?value:phonePresentation(value)} onFocus={()=>setEditing(true)} onBlur={()=>setEditing(false)} onChange={event=>change(event.target.value)}/><p className="field-help">Country codes and extensions are welcome. Your original entry is kept.</p></>;
}
