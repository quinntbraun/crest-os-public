import {authentication} from './authentication';
import {customers} from './customers';
type Item=Readonly<{id:string;name:string;contact:string;archived:boolean}>;
export type AddressCustomerLookupView=Readonly<{items:readonly Item[];busy:boolean;hasMore:boolean;search:string;includeArchived:boolean;message:string}>;
export const initialAddressCustomerLookup:AddressCustomerLookupView={items:[],busy:false,hasMore:false,search:'',includeArchived:false,message:'Search saved customers by name, phone or email.'};
type Dependencies={session:typeof authentication.session;context:typeof customers.context;list:typeof customers.list;change:(view:AddressCustomerLookupView)=>void};
export function createAddressCustomerLookup(overrides:Partial<Dependencies>&Pick<Dependencies,'change'>){
 const deps={session:authentication.session,context:customers.context,list:customers.list,...overrides};
 let view=initialAddressCustomerLookup,active:AbortController|null=null,businessId:string|null=null,disposed=false;
 function emit(next:AddressCustomerLookupView){view=next;if(!disposed)deps.change(view);}
 function suspend(){active?.abort();active=null;businessId=null;emit({...initialAddressCustomerLookup,message:'Customer results cleared. Search again when you are ready.'});}
 async function search(text:string,includeArchived:boolean,more=false){
  if(disposed||active||more&&(!view.hasMore||text!==view.search||includeArchived!==view.includeArchived))return;
  if([...text].length>200){emit({...view,message:'Use 200 characters or fewer to search.'});return;}
  const afterId=more?view.items.at(-1)?.id??null:null,previousBusiness=businessId,work=new AbortController();
  active=work;emit({...initialAddressCustomerLookup,search:text,includeArchived,busy:true,message:'Finding saved customers…'});
  const live=()=>!disposed&&!work.signal.aborted&&active===work;
  try{
   const proof=await deps.session(work.signal);if(!live())return;
   const snapshot=await deps.context(proof,work.signal);if(!live())return;
   if(more&&snapshot.context.businessId!==previousBusiness)throw Error('CUSTOMER_CONTEXT_CHANGED');
   const result=await deps.list(snapshot.context.businessId,{search:text,afterId,includeArchived,pageSize:10},proof,work.signal);if(!live())return;
   businessId=snapshot.context.businessId;
   emit({items:result.customers.map(row=>({id:row.id,name:row.display_name,contact:[row.phone_raw,row.email_raw].filter(Boolean).join(' · '),archived:row.archived_at!==null})),busy:false,hasMore:result.hasMore,search:text,includeArchived,message:result.customers.length?'Choose a customer to open their saved addresses.':'No matching customers on this page. Try another search or open Customers.'});
  }catch{if(live()){businessId=null;emit({...initialAddressCustomerLookup,search:text,includeArchived,message:'Customer search could not be verified. Search again or open Customers to check access.'});}}
  finally{if(active===work)active=null;}
 }
 return {view:()=>view,search,suspend,dispose(){disposed=true;active?.abort();active=null;businessId=null;view=initialAddressCustomerLookup;}};
}
