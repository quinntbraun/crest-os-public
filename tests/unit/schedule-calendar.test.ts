import {it,expect} from 'vitest';
import {calendarDays,calendarMarks,calendarRange,calendarToday,moveCalendarRange,shiftCalendarDay} from '../../src/client/schedule-calendar';
import {bookingContextFixture} from '../fixtures/booking-context';
it('moves real calendar dates across month, leap-year and year boundaries',()=>{
 expect(shiftCalendarDay('2026-12-31',1)).toBe('2027-01-01');expect(shiftCalendarDay('2024-02-28',1)).toBe('2024-02-29');expect(shiftCalendarDay('2025-03-01',-1)).toBe('2025-02-28');
 for(const value of ['2026-02-29','2026-13-01','0000-01-01','2026-1-01'])expect(()=>shiftCalendarDay(value,1)).toThrow();expect(()=>shiftCalendarDay('2026-01-01',1.5)).toThrow();expect(()=>shiftCalendarDay('9999-12-31',1)).toThrow();
});
it('selects exact day, seven-day and month ranges without assuming workdays',()=>{
 expect(calendarRange('2026-11-01','day')).toEqual({fromDate:'2026-11-01',throughDate:'2026-11-01'});expect(calendarRange('2026-12-29','week')).toEqual({fromDate:'2026-12-29',throughDate:'2027-01-04'});expect(calendarRange('2024-02-18','month')).toEqual({fromDate:'2024-02-01',throughDate:'2024-02-29'});expect(calendarRange('9999-12-18','month').throughDate).toBe('9999-12-31');
});
it('moves periods reversibly and refuses dates outside the supported range',()=>{
 for(const mode of ['day','week','month','custom'] as const){const original=mode==='custom'?{fromDate:'2026-12-28',throughDate:'2027-01-02'}:calendarRange('2026-12-28',mode),next=moveCalendarRange(original,mode,1);expect(next).not.toBeNull();expect(moveCalendarRange(next!,mode,-1)).toEqual(original);}
 expect(moveCalendarRange(calendarRange('0001-01-01','month'),'month',-1)).toBeNull();expect(moveCalendarRange(calendarRange('9999-12-01','month'),'month',1)).toBeNull();expect(moveCalendarRange({fromDate:'2026-01-01',throughDate:'2026-12-31'},'custom',1)).toBeNull();
});
it('builds complete months and bounded adjacent day choices',()=>{
 const month=calendarDays(calendarRange('2026-02-15','month'),'month');expect(month).toHaveLength(28);expect(month[0]).toBe('2026-02-01');expect(month.at(-1)).toBe('2026-02-28');expect(calendarDays(calendarRange('2026-02-15','day'),'day')).toEqual(['2026-02-12','2026-02-13','2026-02-14','2026-02-15','2026-02-16','2026-02-17','2026-02-18']);expect(calendarDays(calendarRange('0001-01-01','day'),'day')).toHaveLength(4);expect(calendarDays({fromDate:'2026-01-01',throughDate:'2026-01-02'},'custom')).toEqual([]);
});
it('uses the business zone for today rather than the laptop zone',()=>{
 const now=new Date('2026-11-03T02:00:00Z');expect(calendarToday('America/Indiana/Indianapolis',now)).toBe('2026-11-02');expect(calendarToday('UTC',now)).toBe('2026-11-03');expect(()=>calendarToday('Invalid/Zone',now)).toThrow();
});
it('marks overlapping loaded visits across the DST date and keeps cancelled visits explicit',()=>{
 const f=bookingContextFixture(),job={...f.summary,state:'scheduled' as const,startAt:'2026-11-01T03:30:00.000000Z',endAt:'2026-11-01T07:00:00.000000Z'},marks=calendarMarks(['2026-10-31','2026-11-01','2026-11-02'],[job,{...job,jobId:crypto.randomUUID(),state:'cancelled' as const}],'America/Indiana/Indianapolis');
 expect(marks.get('2026-10-31')).toEqual({visits:2,cancelled:1});expect(marks.get('2026-11-01')).toEqual({visits:2,cancelled:1});expect(marks.get('2026-11-02')).toEqual({visits:0,cancelled:0});
});
it('respects an exclusive midnight end without erasing microseconds past midnight',()=>{
 const f=bookingContextFixture(),days=['2026-11-02','2026-11-03'],job={...f.summary,state:'scheduled' as const,startAt:'2026-11-02T23:00:00.000000Z',endAt:'2026-11-03T00:00:00.000000Z'};expect(calendarMarks(days,[job],'UTC').get('2026-11-03')!.visits).toBe(0);expect(calendarMarks(days,[{...job,endAt:'2026-11-03T00:00:00.000001Z'}],'UTC').get('2026-11-03')!.visits).toBe(1);expect(calendarMarks(days,[job],'UTC').get('2026-11-02')!.visits).toBe(1);
});
it('refuses duplicated or invalid loaded records rather than inventing counts',()=>{
 const summary={...bookingContextFixture().summary,state:'scheduled' as const};expect(()=>calendarMarks(['2026-11-03'],[summary,summary],'UTC')).toThrow();expect(()=>calendarMarks(['2026-11-03'],[{...summary,startAt:'invalid'}],'UTC')).toThrow();expect(()=>calendarMarks(['2026-11-03'],[{...summary,endAt:summary.startAt}],'UTC')).toThrow();
});
