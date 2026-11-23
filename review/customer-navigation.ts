import {customerUuid} from '../src/customer/customer-contract.ts';

// Sample-only navigation metadata, never authorization or a save payload.
export function readReviewCustomerNavigation(params:URLSearchParams):{initialCustomerId:string|null;initialSection:'overview'|'vehicles'|'visits'|'payments'|'history';initialIncludeAll:boolean;initialVehicleFocus:string|null}|null{
 const allowed=new Set(['customer','view','include','focusVehicle']);
 for(const key of params.keys())if(!allowed.has(key)||params.getAll(key).length!==1)return null;
 const customer=params.get('customer'),view=params.get('view'),include=params.get('include'),focus=params.get('focusVehicle');
 if(customer!==null&&!customerUuid(customer)||include!==null&&include!=='archived'||view!==null&&!['overview','vehicles','visits','payments','history'].includes(view)||focus!==null&&(!customerUuid(focus)||view!=='vehicles'||!customer))return null;
 const section=view==='vehicles'||view==='visits'||view==='payments'||view==='history'?view:'overview';
 return{initialCustomerId:customer,initialSection:section,initialIncludeAll:include==='archived',initialVehicleFocus:focus};
}
