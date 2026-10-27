'use client';
import {PhoneInput} from './phone-input';
type NullableProps={label:string;name:string;value:string|null;limit:number;multiline?:boolean;disabled:boolean;change:(value:string|null)=>void};
export function NullableText({label,name,value,limit,multiline=false,disabled,change}:NullableProps){
  if(name==='phone')return <fieldset disabled={disabled}><legend>{label} (optional)</legend><PhoneInput name={name} value={value??''} limit={limit} change={next=>change(next.length?next:null)}/><p className="field-help">Leave blank if the number is unknown.</p></fieldset>;
  if(name==='email')return <fieldset disabled={disabled}><legend>{label} (optional)</legend><label className="visually-hidden" htmlFor={name}>Email value</label><input id={name} name={name} type="text" inputMode="email" autoComplete="email" placeholder="name@example.com" maxLength={limit*2} value={value??''} onChange={event=>change(event.target.value.length?event.target.value:null)}/><p className="field-help">Leave blank if unknown. Saving an email does not verify it or send a message.</p></fieldset>;
  return <fieldset disabled={disabled}><legend>{label}</legend><label className="trust"><input type="checkbox" checked={value!==null} onChange={event=>change(event.target.checked?'':null)}/>Record {label.toLowerCase()}</label>
    {value!==null&&<><label className="visually-hidden" htmlFor={name}>{label} value</label>{multiline?<textarea id={name} name={name} rows={3} maxLength={limit*2} value={value} onChange={event=>change(event.target.value)}/>:<input id={name} name={name} type="text" autoComplete={name==='email'?'email':'off'} inputMode={name==='email'?'email':'text'} maxLength={limit*2} value={value} onChange={event=>change(event.target.value)}/>}
      <p className="field-help">{[...value].length}/{limit} characters.{(name==='phone'||name==='email')&&' Enter a value or uncheck to leave it unknown.'}</p></>}
    {value===null&&<p className="field-help">Unknown / not recorded.</p>}
  </fieldset>;
}
