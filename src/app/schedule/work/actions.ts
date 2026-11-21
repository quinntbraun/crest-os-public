import type {FieldAction} from '../../../operations/field-session-contract';
import type {parseJobResources} from '../../../operations/booking-context-contract';

type Job=Exclude<ReturnType<typeof parseJobResources>,{state:'absent'}>['head']['job'];

export function defaultWorkAction(job:Pick<Job,'state'|'fulfillment_mode'>):FieldAction|null{
 switch(job.state){
  case 'scheduled':
   if(job.fulfillment_mode==='mobile')return 'depart';
   if(job.fulfillment_mode==='dropoff')return 'start_dropoff';
   if(job.fulfillment_mode==='pickup_return')return 'start_pickup';
   return null;
  case 'en_route': return job.fulfillment_mode==='mobile'?'arrive':null;
  case 'in_progress': return 'pause';
  case 'paused': return 'resume';
  default: return null;
 }
}

export const workActionLabels:Readonly<Record<FieldAction,string>>={
 depart:'Record departure',
 arrive:'Record arrival and start work',
 direct_arrive:'Start work without recorded travel',
 start_dropoff:'Start work',
 start_pickup:'Start Work',
 pause:'Pause work',
 resume:'Resume work',
};
