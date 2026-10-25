import {leadEstimate} from '../../customer/lead-contract';
// Display/input conversion only; USD estimates are never quote prices or postings.
export function leadDollars(cents:string):string{return leadEstimate(cents)?(BigInt(cents)/100n).toString()+'.'+(BigInt(cents)%100n).toString().padStart(2,'0'):cents;}
export function leadCents(entry:string):string{
 const match=/^(0|[1-9][0-9]{0,16})(?:\.([0-9]{1,2}))?$/.exec(entry);
 return match?(BigInt(match[1]!)*100n+BigInt((match[2]??'').padEnd(2,'0'))).toString():'invalid:'+entry;
}
// The field explicitly names UTC. Never infer a browser timezone or use Date,
// which would discard PostgreSQL microseconds. Invalid drafts stay unsavable.
export function leadUtc(entry:string):string{
 const match=/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})(?::(\d{2})(?:\.(\d{1,6}))?)?(?:Z| UTC)?$/.exec(entry);
 return match?match[1]+'T'+match[2]+':'+(match[3]??'00')+'.'+(match[4]??'').padEnd(6,'0')+'Z':'invalid:'+entry;
}
