import {it,expect} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {createElement} from 'react';
import {FollowUpInput} from '../../src/app/leads/follow-up-input';
import {followUpWall,followUpCandidates} from '../../src/app/leads/follow-up-time';
it.each([
 ['2026-10-27T09:00','UTC',['2026-10-27T09:00:00.000000Z']],
 ['2026-10-27T09:00','America/Indiana/Indianapolis',['2026-10-27T13:00:00.000000Z']],
 ['2026-10-27T09:00','Asia/Kolkata',['2026-10-27T03:30:00.000000Z']],
 ['2026-10-27T09:00','Asia/Kathmandu',['2026-10-27T03:15:00.000000Z']],
 ['2026-11-01T01:30','America/New_York',['2026-11-01T05:30:00.000000Z','2026-11-01T06:30:00.000000Z']],
 ['2026-03-08T02:30','America/New_York',[]],
 ['2026-04-05T01:45','Australia/Lord_Howe',['2026-04-04T14:45:00.000000Z','2026-04-04T15:15:00.000000Z']],
 ['2026-10-04T02:15','Australia/Lord_Howe',[]],
 ['2028-02-29T12:00','UTC',['2028-02-29T12:00:00.000000Z']]
 ] as const)('resolves exact local instants and DST gaps/folds: %s %s',(wall,zone,expected)=>expect(followUpCandidates(wall,zone)).toEqual(expected));
it.each(['','2026-02-29T12:00','2026-02-30T12:00','2026-10-27T24:00','2026-10-27T09:00Z','2026-10-27T09:00:01'])('refuses malformed or invalid wall time: %s',wall=>expect(followUpCandidates(wall,'UTC')).toEqual([]));
it('rejects an unsupported zone without inventing UTC',()=>expect(followUpCandidates('2026-10-27T09:00','Not/AZone')).toEqual([]));
it('shows local minutes while keeping the source microseconds untouched',()=>{
 const source='2026-10-27T13:30:01.123456Z';expect(followUpWall(source,'America/Indiana/Indianapolis')).toBe('2026-10-27T09:30');expect(source).toBe('2026-10-27T13:30:01.123456Z');
 const html=renderToStaticMarkup(createElement(FollowUpInput,{value:source,change:()=>{throw Error('Rendering must not edit the saved time');}}));expect(html).toContain(source);expect(html).toContain('datetime-local');expect(html).toContain('Precise UTC entry');
});
it('does not render an invalid stored value as a valid calendar time',()=>{expect(followUpWall('invalid','UTC')).toBe('');expect(followUpWall('2026-10-27T13:30:01.123456Z','Not/AZone')).toBe('');});
