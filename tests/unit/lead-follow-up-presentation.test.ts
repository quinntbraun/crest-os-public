import {describe,expect,it} from 'vitest';
import {loadedFollowUpGroups} from '../../src/app/leads/follow-up-presentation';
import type {LeadFollowUp} from '../../src/customer/lead-follow-up-contract';
const at='2026-11-18T12:00:00.123456Z';
const row=(id:string,followUpAt:string,state:LeadFollowUp['state']='new'):LeadFollowUp=>({id,label:id,followUpAt,state});
describe('loaded reminder presentation',()=>{
 it('does not turn unavailable or invalid observation time into an empty success',()=>{expect(loadedFollowUpGroups(null)).toBeNull();expect(loadedFollowUpGroups({observedAt:'invalid',followUps:[]})).toBeNull();expect(loadedFollowUpGroups({observedAt:at,followUps:[row('invalid','2026-11-18T12:00:00Z')]})).toBeNull();});
 it('preserves exact microsecond ordering and treats the observed boundary as due',()=>{const before=row('before','2026-11-18T12:00:00.123455Z'),equal=row('equal',at),after=row('after','2026-11-18T12:00:00.123457Z');const page={observedAt:at,followUps:[before,equal,after]};expect(loadedFollowUpGroups(page)).toEqual({all:page.followUps,due:[before,equal],upcoming:[after]});});
 it('keeps Lost and Won reminders eligible and does not reorder the authorized page',()=>{const first=row('lost',at,'lost'),second=row('won',at,'won');expect(loadedFollowUpGroups({observedAt:at,followUps:[first,second]})?.due).toEqual([first,second]);});
 it('retains a genuinely empty loaded page and never changes the input',()=>{const page=Object.freeze({observedAt:at,followUps:Object.freeze([])});expect(loadedFollowUpGroups(page)).toEqual({all:[],due:[],upcoming:[]});expect(page).toEqual({observedAt:at,followUps:[]});});
});
