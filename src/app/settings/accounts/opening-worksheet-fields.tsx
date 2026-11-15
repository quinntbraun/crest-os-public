import type {OpeningDocument} from '../../../bookkeeping/opening-worksheet-contract';

export const value=(form:FormData,name:string)=>String(form.get(name)??'').trim();

export function amount(input:string){
 const parts=/^(-?)(0|[1-9][0-9]{0,15})(?:\.([0-9]{1,2}))?$/.exec(input);
 if(!parts)throw Error('Enter dollar amounts with up to two decimal places.');
 const absolute=BigInt(parts[2]!)*100n+BigInt((parts[3]??'').padEnd(2,'0'));
 return (parts[1]?-absolute:absolute).toString();
}
export function dollars(value:string|null){
 if(value===null)return '';
 const cents=BigInt(value),absolute=cents<0n?-cents:cents;
 return `${cents<0n?'-':''}${absolute/100n}.${String(absolute%100n).padStart(2,'0')}`;
}
export function readEvidence(form:FormData,name:string):OpeningDocument{
 return {reference:value(form,`${name}-reference`),sha256:value(form,`${name}-sha256`).toLowerCase()};
}
export function EvidenceFields({name,initial}:{name:string;initial?:OpeningDocument|null|undefined}){
 return <>
  <label htmlFor={`${name}-reference`}>Document reference</label>
  <input id={`${name}-reference`} name={`${name}-reference`} required maxLength={200} defaultValue={initial?.reference}/>
  <label htmlFor={`${name}-sha256`}>Document SHA-256 checksum</label>
  <input id={`${name}-sha256`} name={`${name}-sha256`} required minLength={64} maxLength={64} pattern="[a-fA-F0-9]{64}"
   autoCapitalize="none" spellCheck={false} defaultValue={initial?.sha256}/>
 </>;
}
export function Note({name,initial,label}:{name:string;initial:string|undefined;label:string}){
 return <>
  <label htmlFor={name}>{label}</label>
  <input id={name} name={name} required maxLength={1000} defaultValue={initial}/>
 </>;
}
export function DollarField({name,label,initial}:{name:string;label:string;initial:string|null|undefined}){
 return <>
  <label htmlFor={name}>{label}</label>
  <input id={name} name={name} required inputMode="decimal" maxLength={20} defaultValue={dollars(initial??null)}/>
 </>;
}
