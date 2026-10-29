// Disposable browser fixture only, with actual authenticated application clients.
import {createRoot} from 'react-dom/client';
import {AppointmentHoldScreen} from '../../src/app/appointment-holds/screen';
import {authentication} from '../../src/client/authentication';
import {customers} from '../../src/client/customers';
import type {LoginInput} from '../../src/client/authentication';
declare global{interface Window{crestHoldFixture:Readonly<{signIn:(input:LoginInput)=>Promise<void>;show:()=>void;createCustomer:(business:string,label:string)=>Promise<void>}>}}
const node=document.getElementById('fixture');if(!node)throw Error('HOLD_BROWSER_FIXTURE_ROOT_REQUIRED');const root=createRoot(node);
Object.defineProperty(window,'crestHoldFixture',{value:Object.freeze({async signIn(input:LoginInput){await authentication.login(input,new AbortController().signal);},show(){root.render(<AppointmentHoldScreen/>);},async createCustomer(business:string,label:string){const signal=new AbortController().signal,proof=await authentication.session(signal),context=await customers.context(proof,signal);if(context.context.businessId!==business||context.context.writeState!=='ready')throw Error('HOLD_FIXTURE_CUSTOMER_CONTEXT_REQUIRED');const result=await customers.save(business,{schemaVersion:1,operationId:crypto.randomUUID(),customerId:crypto.randomUUID(),expectedVersion:'0',recoveryEpoch:context.context.recoveryEpoch,draft:{displayName:label,phone:null,email:null,contactPreference:null,outreachOptOut:false,notes:null,customerSince:null,archived:false,archiveReason:null}},proof,signal);if(result.state!=='committed')throw Error('HOLD_FIXTURE_CUSTOMER_SAVE_REQUIRED');}}),writable:false,configurable:false});
