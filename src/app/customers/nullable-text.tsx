'use client';
import {PhoneInput} from './phone-input';
type NullableProps={label:string;name:string;value:string|null;limit:number;multiline?:boolean;disabled:boolean;change:(value:string|null)=>void};
export function NullableText({label,name,value,limit,multiline=false,disabled,change}:NullableProps){
  if(name==='phone')return <fieldset disabled={disabled}><legend>{label} (optional)</legend><PhoneInput name={name} value={value??''} limit={limit} change={next=>change(next.length?next:null)}/><p className="field-help">Leave blank if the number is unknown.</p></fieldset>;
  if(name==='email')return <fieldset disabled={disabled}><legend>{label} (optional)</legend><label className="visually-hidden" htmlFor={name}>Email value</label><input id={name} name={name} type="text" inputMode="email" autoComplete="email" placeholder="name@example.com" maxLength={limit*2} value={value??''} onChange={event=>change(event.target.value.length?event.target.value:null)}/><p className="field-help">Leave blank if unknown. Saving an email does not verify it or send a message.</p></fieldset>;
  // Untouched historical empty strings remain unchanged. A deliberate clear
  // records unknown; never normalize existing records merely by opening them.
  const changed=(next:string)=>change(next.length?next:null);
  return <div className="optional-field"><label htmlFor={name}>{label}</label>{multiline?<textarea id={name} name={name} rows={3} maxLength={limit*2} value={value??''} disabled={disabled} onChange={event=>changed(event.target.value)}/>:<input id={name} name={name} type="text" autoComplete="off" maxLength={limit*2} value={value??''} disabled={disabled} onChange={event=>changed(event.target.value)}/>}
    {!!value?.length&&<p className="field-help">{[...value].length}/{limit} characters.</p>}
  </div>;
}
