import assert from 'node:assert/strict';
import {readFile,mkdir,readdir,writeFile} from 'node:fs/promises';
import {spawn,execFileSync} from 'node:child_process';
import {browserGroups,browserGroupFiles} from '../src/tooling/browser-groups.ts';

const pkg=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8')),command=pkg.scripts['test:sign-in-browser'];
const plan=Object.keys(browserGroups).map(name=>({name,files:browserGroupFiles(command,name)}));
if(process.argv.length===3&&process.argv[2]==='--list'){
 console.log(JSON.stringify({groups:plan,totalFiles:plan.reduce((n,g)=>n+g.files.length,0)},null,2));
}else{
 assert.equal(process.argv.length,3);if(process.env.CI==='true')assert.equal(Number(process.env.CREST_BROWSER_JOB_TOTAL),plan.length,'Every browser matrix entry is required');
 // TAP emits each failure with its details as soon as the test finishes.
 const selected=process.argv[2],files=browserGroupFiles(command,selected),args=['--test','--test-reporter=tap','--test-concurrency=1',...files];
 console.log('REQUIRED_BROWSER_GROUP '+JSON.stringify({group:selected,files}));
 const env={...process.env,CREST_TEST_PAYMENT_CORRECTIONS:selected==='records'?'1':'0',
   CREST_TEST_FUND_APPLICATIONS:selected==='records'?'1':'0',CREST_TEST_HELD_TIPS:selected==='records'?'1':'0',CREST_TEST_INVOICE_CREDITS:selected==='records'?'1':'0',CREST_TEST_PAID_INVOICE_CREDITS:selected==='records'?'1':'0',CREST_TEST_SERVICE_REFUNDS:selected==='records'?'1':'0',CREST_TEST_RECEIVABLE_AGING:selected==='records'?'1':'0',CREST_TEST_CUSTOMER_FUNDS_REPORT:selected==='records'?'1':'0',CREST_TEST_EXCESS_RECEIPTS:'0',CREST_TEST_RECEIPT_FUNDS_APPLICATION:'0',CREST_TEST_EXCESS_RETURN_EXPORT:'0',CREST_TEST_TIP_RETURN_EXPORT:'0',CREST_TEST_POSTED_FINANCE_EXPORT:selected==='records'?'1':'0'};
 const run=(testArgs,testEnv)=>{
  const child=spawn(process.execPath,testArgs,{stdio:'inherit',windowsHide:true,env:testEnv});
  return new Promise(resolve=>{child.once('error',()=>resolve({code:1,signal:null}));child.once('close',(code,signal)=>resolve({code,signal}));});
 };
 let result=await run(args,env);
 if(selected==='records'){
  const invoiceJourney=['--test','--test-reporter=tap','--test-concurrency=1','tests/integration/finance-invoice-issue-product-browser.test.mjs'];
  for(const capabilities of [{CREST_TEST_RECEIPT_FUNDS_APPLICATION:'1'},
    {CREST_TEST_EXCESS_RETURN_EXPORT:'1',CREST_TEST_TIP_RETURN_EXPORT:'1'}]){
   if(result.code!==0||result.signal!==null)break;
   result=await run(invoiceJourney,{...env,CREST_TEST_EXCESS_RECEIPTS:'1',...capabilities});
  }
 }
 let screenshots=[];
 try {
  screenshots=(await readdir('.local/review')).filter(name=>/^(settings|workspace|home|quote|amendment|appointment|field|completion|mileage|travel|finance)-.*\.png$/.test(name)).sort();
 } catch(error) {
  if(error.code!=='ENOENT')throw error;
 }
 const needsScreenshots=['commercial','amendments','schedule','field','custody','records'].includes(selected);
 const requiredViewsByGroup={
  records:['workspace-menu','finance-account-settings-recovery','finance-mapping-history','finance-mapping-manage','finance-tax-approval','finance-tax-history','finance-tax-preview','finance-category-approval','finance-category-history','finance-channel-opening','finance-channel-history','finance-invoice-issue-product','finance-direct-receipt','finance-expense-posting','finance-trial-balance','finance-payment-correction','finance-fund-application','finance-apply-received-funds','finance-held-tip','finance-invoice-credit','finance-paid-invoice-credit','finance-service-refund','finance-excess-return','finance-posted-export','settings-calendar-synced','settings-calendar-pending'],
  field:['field-departure','field-pause','completion-editor','completion-saved','mileage-form','mileage-split','mileage-saved','field-cancellation','field-work-time','field-work-boundary','mileage-departure-correction','completion-outcome','completion-history','field-maintenance-history','completion-invoice-preparation','completion-invoice-draft'],
  custody:['field-dropoff-intake','field-dropoff-work','field-dropoff-cancellation','field-dropoff-completion',
   'field-dropoff-collections','field-dropoff-history','field-dropoff-policy-revision',
   'field-pickup-policy','field-pickup-departure','field-pickup-collection','field-pickup-photo',
   'field-pickup-worksite','field-pickup-start-work','field-pickup-return-travel','field-pickup-return-handoff',
   'field-pickup-return-failed','field-pickup-return-queue']
 };
 const requiredViews=requiredViewsByGroup[selected]??[];
 if(selected==='records')requiredViews.push('finance-tip-return');
 const requiredScreenshots=requiredViews.flatMap(view=>['chromium','webkit'].flatMap(engine=>
  [360,390,768,1440].map(width=>`${view}-${engine}-${width}.png`)));
 if(selected==='records')for(const view of ['settings-calendar-default-disclosure','settings-calendar-disclosure'])
  for(const width of [360,390,768,1440])requiredScreenshots.push(view+'-chromium-'+width+'.png');
 const missingScreenshots=requiredScreenshots.filter(name=>!screenshots.includes(name));
 const passed=result.code===0&&result.signal===null&&(!needsScreenshots||screenshots.length>0)&&missingScreenshots.length===0;
 await mkdir('.local/ci-browser',{recursive:true});await writeFile('.local/ci-browser/'+selected+'.json',JSON.stringify({schemaVersion:1,sourceCommit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),group:selected,files,args,childExitCode:result.code,childSignal:result.signal,screenshots,screenshotsRequired:needsScreenshots,passed},null,2)+'\n',{flag:'wx'});
 if(!passed){
  if(missingScreenshots.length)console.error('MISSING_REQUIRED_SCREENSHOTS '+JSON.stringify(missingScreenshots));
  console.error('REQUIRED_BROWSER_GROUP_FAILED');process.exitCode=typeof result.code==='number'&&result.code!==0?result.code:1;
 }
}
