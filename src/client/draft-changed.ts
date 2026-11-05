// CRM drafts contain flat scalar fields. Compare editing intent, including
// invalid values and explicit empty strings; validity is a separate concern.
export function draftChanged<T extends object>(draft:T|null,baseline:T):boolean{
 if(draft===null)return false;
 return Object.keys(draft).length!==Object.keys(baseline).length||(Object.keys(baseline) as (keyof T)[]).some(key=>!Object.is(draft[key],baseline[key]));
}
