import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {expect,it} from 'vitest';
import {readScheduleNavigation,scheduleNavigationHref} from '../../src/client/schedule-navigation';
import {ScheduleLink,ScheduleNavigationProvider} from '../../src/app/schedule/navigation';
import {BackToSavedJob} from '../../src/app/schedule/back-to-saved-job';

const job='11111111-1111-4111-8111-111111111111';
const input={plannerFrom:'2026-11-01',plannerThrough:'2026-11-30',plannerView:'month',plannerCalendar:'open',plannerRange:'open',plannerFocus:job,plannerY:'642',plannerWidth:'390'};
const query=(href:string)=>Object.fromEntries(new URL(href,'https://crest.invalid').searchParams);

it('round-trips real calendar views, exact dates and bounded origin coordinates',()=>{
 for(const [mode,from,through] of [['day','2026-12-31','2026-12-31'],['week','2026-12-29','2027-01-04'],['month','2024-02-01','2024-02-29'],['custom','2026-11-03','2026-11-11']]){
  const context=readScheduleNavigation({...input,plannerFrom:from,plannerThrough:through,plannerView:mode});
  expect(context).toEqual({fromDate:from,throughDate:through,mode,calendarOpen:true,rangeOpen:true,focusJobId:job,originY:642,originWidth:390});
  expect(readScheduleNavigation(query(scheduleNavigationHref('/schedule',context)))).toEqual(context);
 }
});

it('refuses malformed, ambiguous, misleading and oversized calendar contexts',()=>{
 for(const change of [{plannerFrom:'2026-02-30'},{plannerFrom:['2026-11-01']},{plannerThrough:'2026-10-31'},
  {plannerThrough:'2027-03-01',plannerView:'custom'},{plannerView:['month']},{plannerView:'year'},{plannerView:'week'},
  {plannerView:'day'},{plannerFrom:'2026-11-02'},{plannerCalendar:['open']},{plannerCalendar:'yes'},{plannerRange:['open']}]){
  expect(readScheduleNavigation({...input,...change})).toBeNull();
 }
 expect(readScheduleNavigation({})).toBeNull();
 expect(readScheduleNavigation({...input,plannerFocus:'https://other.invalid',plannerY:'-1'})).toEqual({fromDate:'2026-11-01',throughDate:'2026-11-30',mode:'month',calendarOpen:true,rangeOpen:true});
 for(const position of [{plannerY:'1e6'},{plannerWidth:['390']},{plannerY:'999999999'},{plannerWidth:'0'}]){
  const context=readScheduleNavigation({...input,...position});expect(context?.focusJobId).toBe(job);expect(context?.originY).toBeUndefined();expect(context?.originWidth).toBeUndefined();
 }
});

it('preserves task identifiers and fragments without carrying arbitrary private query fields',()=>{
 const context=readScheduleNavigation({...input,customerName:'PRIVATE_CUSTOMER',notes:'PRIVATE_DRAFT',returnTo:'https://other.invalid'});
 const href=scheduleNavigationHref('/schedule/change?job='+job+'&kind=cancel&plannerView=day&plannerView=week#review',context);
 const url=new URL(href,'https://crest.invalid');
 expect(url.pathname).toBe('/schedule/change');expect(url.searchParams.get('job')).toBe(job);expect(url.searchParams.get('kind')).toBe('cancel');expect(url.hash).toBe('#review');
 expect(url.searchParams.getAll('plannerView')).toEqual(['month']);expect(href).not.toMatch(/PRIVATE_|returnTo|other\.invalid/);
 for(const path of ['/customers?job='+job,'https://other.invalid/schedule','//other.invalid/schedule','/schedule-unrelated','/sign-in'])expect(scheduleNavigationHref(path,context)).toBe(path);
 expect(scheduleNavigationHref('/schedule?job='+job,null)).toBe('/schedule?job='+job);
});

it('renders ordinary usable links with context before hydration and preserves anchor semantics',()=>{
 const context=readScheduleNavigation(input);
 const html=renderToStaticMarkup(createElement(ScheduleNavigationProvider,{context,children:createElement(ScheduleLink,{href:'/schedule/work?job='+job,'aria-label':'Open work',target:'_blank',rel:'noopener'},'Work')}));
 expect(html).toContain('plannerFrom=2026-11-01');expect(html).toContain('plannerFocus='+job);
 expect(html).toContain('aria-label="Open work"');expect(html).toContain('target="_blank"');expect(html).toContain('rel="noopener"');expect(html).toContain('>Work</a>');expect(html).not.toMatch(/onClick|PRIVATE_/);
});

it('preserves fractional CSS scroll positions without rounding during real-zoom navigation',()=>{
 for(const value of ['0.5','642.6666666666666','12345.125']){
  const context=readScheduleNavigation({...input,plannerY:value});expect(context?.originY).toBe(Number(value));
  const href=scheduleNavigationHref('/schedule/work?job='+job,context);expect(query(href).plannerY).toBe(value);
  expect(readScheduleNavigation(query(href))?.originY).toBe(Number(value));
 }
});

it('keeps Schedule context across verified customer and vehicle record links and server-rendered returns',()=>{
 const context=readScheduleNavigation(input),record='22222222-2222-4222-8222-222222222222';
 for(const [path,key]of [['/customers','customer'],['/vehicles','vehicle']] as const){
  const href=scheduleNavigationHref(path+'?'+key+'='+record+'&job='+job+'&view=visits',context);
  expect(readScheduleNavigation(query(href))).toEqual(context);
  expect(query(href)).toMatchObject({[key]:record,job,view:'visits'});
  const html=renderToStaticMarkup(createElement(BackToSavedJob,{job,jobVehicle:record,navigation:readScheduleNavigation(query(href))}));
  const back=html.match(/href="([^"]+)"/)?.[1]?.replaceAll('&amp;','&');
  expect(back).toBeDefined();expect(query(back!)).toMatchObject({job,vehicle:record});
  expect(readScheduleNavigation(query(back!))).toEqual(context);
 }
 for(const href of ['/customers?customer='+record,'/vehicles?vehicle='+record+'&job=invalid',
  '/vehicles?vehicle='+record+'&job='+job+'&job='+job,
  '/customers?customer='+record+'&customer='+record+'&job='+job,
  '/customers/import-review?customer='+record+'&job='+job])expect(scheduleNavigationHref(href,context)).toBe(href);
 expect(renderToStaticMarkup(createElement(BackToSavedJob,{job}))).toContain('href="/schedule?job='+job+'"');
 expect(renderToStaticMarkup(createElement(BackToSavedJob,{job:'invalid',navigation:context}))).toBe('');
});
