import {customerDate,customerUuid} from '../customer/customer-contract';
import {calendarRange} from './schedule-calendar';
import type {CalendarMode,CalendarRange} from './schedule-calendar';

export type ScheduleNavigation=CalendarRange&Readonly<{mode:CalendarMode;calendarOpen:boolean;rangeOpen:boolean;focusJobId?:string;originY?:number;originWidth?:number}>;

export function readScheduleNavigation(input:Readonly<Record<string,unknown>>):ScheduleNavigation|null{
 const fromDate=input.plannerFrom,throughDate=input.plannerThrough,mode=input.plannerView;
 if(!customerDate(fromDate)||!customerDate(throughDate)||throughDate<fromDate
  ||typeof mode!=='string'||!['day','week','month','custom'].includes(mode)
  ||typeof input.plannerCalendar!=='string'||!['open','closed'].includes(input.plannerCalendar)
  ||input.plannerRange!==undefined&&input.plannerRange!=='open'&&input.plannerRange!=='closed')return null;
 const span=(Date.parse(throughDate+'T12:00:00Z')-Date.parse(fromDate+'T12:00:00Z'))/86400000;
 if(span>92)return null;
 if(mode!=='custom'){
  const canonical=calendarRange(fromDate,mode as Exclude<CalendarMode,'custom'>);
  if(canonical.fromDate!==fromDate||canonical.throughDate!==throughDate)return null;
 }
 const position=typeof input.plannerY==='string'&&/^(0|[1-9][0-9]{0,7})(?:\.[0-9]{1,16})?$/.test(input.plannerY)
  &&typeof input.plannerWidth==='string'&&/^[1-9][0-9]{2,4}$/.test(input.plannerWidth)
  ?{originY:Number(input.plannerY),originWidth:Number(input.plannerWidth)}:{};
 return {fromDate,throughDate,mode:mode as CalendarMode,calendarOpen:input.plannerCalendar==='open',rangeOpen:input.plannerRange==='open',
  ...customerUuid(input.plannerFocus)?{focusJobId:input.plannerFocus,...position}:{}};
}

export function scheduleNavigationHref(href:string,context:ScheduleNavigation|null):string{
 if(!context||!href.startsWith('/')||href.startsWith('//'))return href;
 const url=new URL(href,'https://crest.invalid');
 if(url.origin!=='https://crest.invalid')return href;
 const schedule=url.pathname==='/schedule'||url.pathname.startsWith('/schedule/');
 const record=(url.pathname==='/customers'&&url.searchParams.getAll('customer').length===1&&customerUuid(url.searchParams.get('customer'))
  ||url.pathname==='/vehicles'&&url.searchParams.getAll('vehicle').length===1&&customerUuid(url.searchParams.get('vehicle')))
  &&url.searchParams.getAll('job').length===1&&customerUuid(url.searchParams.get('job'));
 if(!schedule&&!record)return href;
 for(const name of ['plannerFrom','plannerThrough','plannerView','plannerCalendar','plannerRange','plannerFocus','plannerY','plannerWidth'])url.searchParams.delete(name);
 url.searchParams.set('plannerFrom',context.fromDate);url.searchParams.set('plannerThrough',context.throughDate);
 url.searchParams.set('plannerView',context.mode);url.searchParams.set('plannerCalendar',context.calendarOpen?'open':'closed');
 url.searchParams.set('plannerRange',context.rangeOpen?'open':'closed');
 if(context.focusJobId)url.searchParams.set('plannerFocus',context.focusJobId);
 if(context.focusJobId&&context.originY!==undefined&&context.originWidth!==undefined){
  url.searchParams.set('plannerY',String(context.originY));url.searchParams.set('plannerWidth',String(context.originWidth));
 }
 return url.pathname+url.search+url.hash;
}
