import {it,expect} from 'vitest';
import {leadDollars,leadCents,leadUtc} from '../../src/app/leads/intake-input';
import {leadEstimate,parseLeadDraft} from '../../src/customer/lead-contract';
import {leadFixture} from '../support/lead-fixture';
import {draftFromLead} from '../../src/customer/lead-contract';
it.each([['0','0.00'],['1','0.01'],['100','1.00'],['9007199254740993','90071992547409.93'],['9223372036854775807','92233720368547758.07']])('round-trips exact cents without Number rounding:%s', (cents,dollars)=>{expect(leadDollars(cents)).toBe(dollars);expect(leadCents(dollars)).toBe(cents);});
it.each(['','1.234','-1','+1','1e2','01','NaN','Infinity',' 1','1 ','$1','92233720368547758.08'])('never turns incomplete/invalid/overflow dollars into a savable estimate:%s',entry=>expect(leadEstimate(leadCents(entry))).toBe(false));
it.each([['2026-10-25 14:30','2026-10-25T14:30:00.000000Z'],['2026-10-25T14:30:01.123456Z','2026-10-25T14:30:01.123456Z'],['2026-10-25 14:30:01.12 UTC','2026-10-25T14:30:01.120000Z']])('preserves declared UTC and exact microseconds:%s',(entry,instant)=>{expect(leadUtc(entry)).toBe(instant);expect(()=>parseLeadDraft({...draftFromLead(leadFixture()),followUpAt:leadUtc(entry)})).not.toThrow();});
it.each(['','2026-02-30 14:30','2026-10-25 24:30','2026-10-25T14:30:00.1234567Z','2026-10-25 14:30-05:00','tomorrow','2026-10-25'])('invalid or ambiguous follow-up cannot be saved:%s',entry=>expect(()=>parseLeadDraft({...draftFromLead(leadFixture()),followUpAt:leadUtc(entry)})).toThrow());
