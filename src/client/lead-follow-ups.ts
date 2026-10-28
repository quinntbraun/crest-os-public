import {authentication,AuthenticationError} from './authentication';
import {leads} from './leads';
import type {LeadState} from '../customer/lead-contract';

export type LeadFollowUp=Readonly<{id:string;label:string;at:string;state:LeadState}>;
export type LeadFollowUpView=Readonly<{
  phase:'loading'|'ready'|'signed-out'|'unavailable';
  busy:boolean;
  message:string;
  rows:readonly LeadFollowUp[];
  scanned:number;
  hasMore:boolean;
  limited:boolean;
  checkedAt:number|null;
}>;
export const initialLeadFollowUpView:LeadFollowUpView=Object.freeze({phase:'loading',busy:false,message:'Checking follow-up access…',rows:Object.freeze([]),scanned:0,hasMore:false,limited:false,checkedAt:null});
type Authority=Awaited<ReturnType<typeof leads.context>>;
type Dependencies={change:(value:LeadFollowUpView)=>void;session?:typeof authentication.session;context?:typeof leads.context;list?:typeof leads.list;now?:()=>number};
const maximumScanned=1000;

/** Read-only live pages, not a consistent export snapshot or a booking queue. */
export function createLeadFollowUps(deps:Dependencies){
  const session=deps.session??authentication.session,context=deps.context??leads.context,list=deps.list??leads.list,now=deps.now??Date.now;
  let alive=true,active:AbortController|null=null,authority:Authority|null=null,cursor:string|null=null;
  let view:LeadFollowUpView=initialLeadFollowUpView;
  function emit(next:LeadFollowUpView){view=Object.freeze({...next,rows:Object.freeze([...next.rows])});if(alive)deps.change(view);}
  function clear(message:string,phase:LeadFollowUpView['phase']='unavailable'){
    authority=null;cursor=null;emit({...initialLeadFollowUpView,phase,message});
  }
  const same=(a:Authority,b:Authority)=>a.binding===b.binding&&a.context.businessId===b.context.businessId&&a.context.writeState===b.context.writeState&&a.context.recoveryEpoch===b.context.recoveryEpoch;
  async function read(more:boolean){
    if(!alive||more&&(active!==null||view.phase!=='ready'||!view.hasMore||view.limited||cursor===null))return;
    active?.abort();const request=new AbortController();active=request;
    const prior=more?view:initialLeadFollowUpView,expected=more?authority:null,after=more?cursor:null;
    // Hide prior private labels while rechecking the current device and business.
    emit({...initialLeadFollowUpView,busy:true,message:more?'Checking the next lead page…':'Checking follow-up access…'});
    try{
      const proof=await session(request.signal),current=await context(proof,request.signal);
      if(!alive||request.signal.aborted||active!==request)return;
      if(more&&(!expected||!same(expected,current))){clear('Sign-in or recovery context changed. Refresh follow-ups to start a new review.');return;}
      const page=await list(current.context.businessId,{search:'',afterId:after,includeLost:true,pageSize:50},proof,request.signal);
      if(!alive||request.signal.aborted||active!==request)return;
      const checkedAt=now();if(!Number.isSafeInteger(checkedAt)||!Number.isFinite(new Date(checkedAt).getTime()))throw Error();
      const additions=page.leads.flatMap(lead=>lead.follow_up_at===null?[]:[Object.freeze({id:lead.id,label:lead.label,at:lead.follow_up_at,state:lead.state})]);
      authority=current;cursor=page.leads.at(-1)?.id??after;
      const scanned=prior.scanned+page.leads.length,limited=page.hasMore&&scanned>=maximumScanned;
      emit({phase:'ready',busy:false,message:'Recorded follow-ups loaded.',rows:[...prior.rows,...additions],scanned,hasMore:page.hasMore,limited,checkedAt});
    }catch(error){
      if(alive&&!request.signal.aborted&&active===request)clear(error instanceof AuthenticationError&&error.kind==='denied'?'Sign in to review follow-ups.':'Follow-ups could not be verified. Refresh or check sign-in; this does not mean there are none.',error instanceof AuthenticationError&&error.kind==='denied'?'signed-out':'unavailable');
    }finally{if(active===request)active=null;}
  }
  return Object.freeze({
    load:()=>read(false),more:()=>read(true),view:()=>view,
    suspend(){if(!alive)return;active?.abort();active=null;clear('Private follow-ups were cleared while away. Refresh to check current records.');},
    dispose(){alive=false;active?.abort();active=null;authority=null;cursor=null;view=initialLeadFollowUpView;}
  });
}

/** Source instants have six fractional digits; retain their exact order and boundary. */
export function groupLeadFollowUps(rows:readonly LeadFollowUp[],checkedAt:number){
  const cutoff=new Date(checkedAt).toISOString().replace(/Z$/,'000Z');
  const sorted=[...rows].sort((a,b)=>a.at<b.at?-1:a.at>b.at?1:a.id<b.id?-1:a.id>b.id?1:0);
  return {due:sorted.filter(row=>row.at<=cutoff),upcoming:sorted.filter(row=>row.at>cutoff)};
}
