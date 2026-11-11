import {readFileSync} from 'node:fs';
import {describe,it,expect} from 'vitest';
import {browserGroups,browserGroupFiles} from '../../src/tooling/browser-groups';

const command=(JSON.parse(readFileSync(new URL('../../package.json',import.meta.url),'utf8')) as {scripts:Record<string,string>}).scripts['test:sign-in-browser']!;
describe('complete required browser grouping',()=>{
 it('partitions every file in the actual retained full command exactly once',()=>{
  const files=Object.keys(browserGroups).flatMap(name=>browserGroupFiles(command,name));
  expect([...files].sort()).toEqual(command.split(' ').slice(3).sort());expect(new Set(files).size).toBe(files.length);expect(files).toHaveLength(39);
 });
 it('requires the actual workflow matrix to retain every distinct group',()=>{
  const workflow=readFileSync(new URL('../../.github/workflows/ci.yml',import.meta.url),'utf8'),matrix=workflow.match(/browser_workflows:[\s\S]*?matrix:\s*\n\s*suite: \[([^\]]+)\]/);
  expect(matrix).not.toBeNull();const names=matrix![1]!.split(',').map(name=>name.trim());expect(names.sort()).toEqual(Object.keys(browserGroups).sort());expect(new Set(names).size).toBe(names.length);
 });
 it('refuses deleting a retained file, adding an unassigned file or dispatching only a selected subset',()=>{
  for(const changed of [command.split(' ').slice(0,-1).join(' '),command+' tests/integration/unassigned-browser.test.mjs','node --test --test-concurrency=1 '+browserGroups.amendments.join(' ')])expect(()=>browserGroupFiles(changed,'amendments')).toThrow('BROWSER_GROUP_COVERAGE_REVIEW_REQUIRED');
 });
 it('refuses duplicate files rather than satisfying the total with repeated coverage',()=>{
  const tokens=command.split(' ');tokens[tokens.length-1]=tokens[3]!;expect(()=>browserGroupFiles(tokens.join(' '),'crm')).toThrow();
 });
 it.each([undefined,null,[],{},'','__proto__','constructor','unknown','crm --test-name-pattern=none'])('refuses missing or substituted group %j',value=>{expect(()=>browserGroupFiles(command,value)).toThrow();});
 it.each([undefined,null,[],{},'node --test','node --test --test-concurrency=2','node --test --test-concurrency=1 --test-name-pattern=none','sh -c '+command])('refuses malformed or filtered complete command %j',value=>{expect(()=>browserGroupFiles(value,'crm')).toThrow();});
 it('retains both engines through their original unchanged files, without filtering individual cases',()=>{
  expect(browserGroupFiles(command,'amendments')).toContain('tests/integration/quote-amendment-acceptance-product-browser.test.mjs');
  expect(browserGroupFiles(command,'commercial')).toContain('tests/integration/quote-commercial-browser.test.mjs');
  expect(browserGroupFiles(command,'schedule')).toContain('tests/integration/job-change-product-browser.test.mjs');
  const field=browserGroupFiles(command,'field');
  expect(field).toHaveLength(9);
  expect(field).toContain('tests/integration/support-trip-product-browser.test.mjs');
  expect(field).toContain('tests/integration/trip-interruption-product-browser.test.mjs');
  expect(field).toContain('tests/integration/unfulfilled-cancellation-product-browser.test.mjs');
  expect(field).toContain('tests/integration/job-work-time-product-browser.test.mjs');
  expect(field).toContain('tests/integration/job-work-boundary-product-browser.test.mjs');
  expect(field).toContain('tests/integration/maintenance-reminders-product-browser.test.mjs');
  expect(browserGroupFiles(command,'custody')).toEqual(['tests/integration/dropoff-custody-product-browser.test.mjs']);
 });
});
