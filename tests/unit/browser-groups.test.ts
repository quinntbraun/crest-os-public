import {readFileSync} from 'node:fs';
import {describe,it,expect} from 'vitest';
import {browserGroups,browserGroupNames,browserGroupFiles,browserScenario,recordBrowserGroupNames,recordBrowserViews} from '../../src/tooling/browser-groups';

const command=(JSON.parse(readFileSync(new URL('../../package.json',import.meta.url),'utf8')) as {scripts:Record<string,string>}).scripts['test:sign-in-browser']!;
describe('complete required browser grouping',()=>{
 it('retains every original records file exactly once across the three required jobs',()=>{
  const retained=['source-export-browser','source-export-product-browser','workspace-journey-browser','owner-expenses-product-browser','finance-account-settings-browser','finance-mapping-settings-browser','finance-tax-profiles-browser','finance-expense-category-browser','finance-money-channel-browser','finance-invoice-issue-product-browser','finance-expense-posting-browser','google-calendar-settings-product-browser'].map(name=>'tests/integration/'+name+'.test.mjs');
  const actual=recordBrowserGroupNames.flatMap(name=>browserGroupFiles(command,name));
  const entry='tests/integration/task-entry-layout-browser.test.mjs',funds='tests/integration/opening-funds-http-auth.test.mjs';
  expect(actual.filter(file=>file!==entry&&file!==funds).sort()).toEqual(retained.sort());expect(new Set(actual).size).toBe(retained.length+2);
  expect(actual.filter(file=>file===entry)).toHaveLength(1);expect(browserGroupFiles(command,'workspace-records')).toContain(entry);
  expect(browserGroupFiles(command,'workspace-records')).toHaveLength(5);expect(browserGroupFiles(command,'accounting-settings')).toHaveLength(6);expect(browserGroupFiles(command,'accounting-settings')).toContain(funds);expect(actual.filter(file=>file===funds)).toHaveLength(1);expect(browserGroupFiles(command,'records')).toHaveLength(3);
 });
 it('retains all original records screenshot requirements without omitting or duplicating a view',()=>{
  const retained=['workspace-menu','finance-account-settings-recovery','finance-mapping-history','finance-mapping-manage','finance-tax-approval','finance-tax-history','finance-tax-preview','finance-category-approval','finance-category-history','finance-channel-opening','finance-channel-history','finance-invoice-issue-product','finance-direct-receipt','finance-expense-posting','finance-trial-balance','finance-balance-sheet','finance-payment-correction','finance-fund-application','finance-held-tip','finance-invoice-credit','finance-paid-invoice-credit','finance-service-refund','finance-posted-export','settings-calendar-synced','settings-calendar-pending'];
  const actual=Object.values(recordBrowserViews).flat();expect(actual.sort()).toEqual(retained.sort());expect(new Set(actual).size).toBe(retained.length);
  const runner=readFileSync(new URL('../../scripts/run-browser-group.mjs',import.meta.url),'utf8');expect(runner).toContain("if(selected==='records')for(const view of ['settings-calendar-default-disclosure','settings-calendar-disclosure'])");
 });
 it('partitions every file in the actual retained full command exactly once',()=>{
  const files=Object.keys(browserGroups).flatMap(name=>browserGroupFiles(command,name));
  expect([...files].sort()).toEqual(command.split(' ').slice(3).sort());expect(new Set(files).size).toBe(files.length);expect(files).toHaveLength(56);
 });
 it('requires the actual workflow matrix to retain every distinct group',()=>{
  const workflow=readFileSync(new URL('../../.github/workflows/ci.yml',import.meta.url),'utf8'),matrix=workflow.match(/browser_workflows:[\s\S]*?matrix:\s*\n\s*suite: \[([^\]]+)\]/);
  expect(matrix).not.toBeNull();const names=matrix![1]!.split(',').map(name=>name.trim());expect(names.sort()).toEqual([...browserGroupNames].sort());expect(new Set(names).size).toBe(names.length);
 });
 it('refuses deleting a retained file, adding an unassigned file or dispatching only a selected subset',()=>{
  for(const changed of [command.split(' ').slice(0,-1).join(' '),command+' tests/integration/unassigned-browser.test.mjs','node --test --test-concurrency=1 '+browserGroups.amendments.join(' ')])expect(()=>browserGroupFiles(changed,'amendments')).toThrow('BROWSER_GROUP_COVERAGE_REVIEW_REQUIRED');
 });
 it('refuses duplicate files rather than satisfying the total with repeated coverage',()=>{
  const tokens=command.split(' ');tokens[tokens.length-1]=tokens[3]!;expect(()=>browserGroupFiles(tokens.join(' '),'crm')).toThrow();
 });
 it.each([undefined,null,[],{},'','__proto__','constructor','unknown','crm --test-name-pattern=none'])('refuses missing or substituted group %j',value=>{expect(()=>browserGroupFiles(command,value)).toThrow();});
 it.each([undefined,null,[],{},'node --test','node --test --test-concurrency=2','node --test --test-concurrency=1 --test-name-pattern=none','sh -c '+command])('refuses malformed or filtered complete command %j',value=>{expect(()=>browserGroupFiles(value,'crm')).toThrow();});
 it('runs both supplemental invoice workflows on separately required jobs with their exact capabilities',()=>{
  const invoice='tests/integration/finance-invoice-issue-product-browser.test.mjs';
  expect(browserGroupNames.filter(group=>browserScenario(group))).toEqual(['receipt-funds','payment-recovery','restored-tip','opening-worksheet','statement-matching','opening-receivables','income-statement']);
  expect(browserGroupFiles(command,'receipt-funds')).toEqual([invoice]);
  expect(browserGroupFiles(command,'payment-recovery')).toEqual([invoice]);
  expect(browserGroupFiles(command,'restored-tip')).toEqual(['tests/integration/finance-restored-tip-product-browser.test.mjs']);
  expect(browserGroupFiles(command,'opening-worksheet')).toEqual(['tests/integration/finance-opening-worksheet-browser.test.mjs']);
  expect(browserGroupFiles(command,'opening-receivables')).toEqual(['tests/integration/finance-opening-worksheet-browser.test.mjs']);
  expect(browserGroupFiles(command,'statement-matching')).toEqual(['tests/integration/finance-statement-staging-browser.test.mjs',
   'tests/integration/finance-expense-posting-browser.test.mjs']);
  expect(browserGroupFiles(command,'statement-staging')).toEqual(['tests/integration/finance-statement-staging-browser.test.mjs']);
  expect(browserGroupFiles(command,'income-statement')).toEqual(['tests/integration/finance-expense-posting-browser.test.mjs']);
  expect(browserGroupFiles(command,'records')).toContain(invoice);
  expect(browserScenario('receipt-funds')).toEqual({CREST_TEST_EXCESS_RECEIPTS:'1',CREST_TEST_RECEIPT_FUNDS_APPLICATION:'1'});
  expect(browserScenario('payment-recovery')).toEqual({
   CREST_TEST_EXCESS_RECEIPTS:'1',CREST_TEST_EXCESS_RETURN_EXPORT:'1',CREST_TEST_TIP_RETURN_EXPORT:'1',
   CREST_TEST_COLLECTION_FAILURE_EXPORT:'1',CREST_TEST_REFUND_TRANSFER_EXPORT:'1',CREST_TEST_DIRECT_RECEIPT_TIP_EXPORT:'1',
   CREST_TEST_REFUND_TRANSFER_FEE_EXPORT:'1',CREST_TEST_COLLECTION_FAILURE_RECREDIT_EXPORT:'1',
   CREST_TEST_COLLECTION_FAILURE_GROUPED_RECREDIT_EXPORT:'1',
  });
  expect(browserScenario('restored-tip')).toEqual({...browserScenario('payment-recovery'),CREST_TEST_RESTORED_TIP_EXPORT:'1'});
  expect(browserScenario('opening-worksheet')).toEqual({...browserScenario('restored-tip'),CREST_TEST_OPENING_WORKSHEET_EXPORT:'1'});
  expect(browserScenario('opening-receivables')).toEqual({...browserScenario('restored-tip'),CREST_TEST_OPENING_AR_PREVIEW:'1'});
  expect(browserScenario('income-statement')).toEqual({...browserScenario('restored-tip'),CREST_TEST_RECORDED_INCOME_STATEMENT:'1'});
 });
 it('retains both engines through their original unchanged files, without filtering individual cases',()=>{
  expect(browserGroupFiles(command,'amendments')).toContain('tests/integration/quote-amendment-acceptance-product-browser.test.mjs');
  expect(browserGroupFiles(command,'commercial')).toContain('tests/integration/quote-commercial-browser.test.mjs');
  expect(browserGroupFiles(command,'schedule')).toContain('tests/integration/job-change-product-browser.test.mjs');
  expect(recordBrowserGroupNames.flatMap(group=>browserGroupFiles(command,group))).toEqual(expect.arrayContaining([
   'tests/integration/finance-account-settings-browser.test.mjs','tests/integration/finance-mapping-settings-browser.test.mjs',
   'tests/integration/finance-tax-profiles-browser.test.mjs','tests/integration/finance-expense-category-browser.test.mjs',
   'tests/integration/finance-money-channel-browser.test.mjs','tests/integration/finance-invoice-issue-product-browser.test.mjs'
  ]));
  const field=browserGroupFiles(command,'field');
  expect(field).toHaveLength(9);
  expect(field).toContain('tests/integration/support-trip-product-browser.test.mjs');
  expect(field).toContain('tests/integration/trip-interruption-product-browser.test.mjs');
  expect(field).toContain('tests/integration/unfulfilled-cancellation-product-browser.test.mjs');
  expect(field).toContain('tests/integration/job-work-time-product-browser.test.mjs');
  expect(field).toContain('tests/integration/job-work-boundary-product-browser.test.mjs');
  expect(field).toContain('tests/integration/maintenance-reminders-product-browser.test.mjs');
  expect(browserGroupFiles(command,'custody')).toEqual(['tests/integration/dropoff-custody-product-browser.test.mjs','tests/integration/dropoff-policy-revision-browser.test.mjs',
   'tests/integration/pickup-trip-product-browser.test.mjs','tests/integration/pickup-custody-photo-browser.test.mjs',
   'tests/integration/pickup-worksite-product-browser.test.mjs']);
 });
});
