'use client';
type NullableProps={label:string;name:string;value:string|null;limit:number;multiline?:boolean;disabled:boolean;change:(value:string|null)=>void};
export function NullableText({label,name,value,limit,multiline=false,disabled,change}:NullableProps){
  return <fieldset disabled={disabled}><legend>{label}</legend><label className="trust"><input type="checkbox" checked={value!==null} onChange={event=>change(event.target.checked?'':null)}/>Record {label.toLowerCase()}</label>
    {value!==null&&<><label className="visually-hidden" htmlFor={name}>{label} value</label>{multiline?<textarea id={name} name={name} rows={3} maxLength={limit*2} value={value} onChange={event=>change(event.target.value)}/>:<input id={name} name={name} type="text" autoComplete="off" maxLength={limit*2} value={value} onChange={event=>change(event.target.value)}/>}
      <p className="field-help">{[...value].length}/{limit} characters.{(name==='phone'||name==='email')&&' Enter a value or uncheck to leave it unknown.'}</p></>}
    {value===null&&<p className="field-help">Unknown / not recorded.</p>}
  </fieldset>;
}
