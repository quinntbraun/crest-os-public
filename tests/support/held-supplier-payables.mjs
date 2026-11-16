import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';

export async function prepareHeldSupplierPayable({sandbox,target,financeUrl,args,day}){
 const finance=await sandbox.connect(financeUrl),worker=await sandbox.connect(target);
 await finance.query('SET ROLE crest_finance_preview');

 const call=async(name,values,connection=finance)=>{
  const request=[...args,randomUUID(),...values];
  const parameters=request.map((_,index)=>'$'+(index+1));
  const {rows:[{result}]}=await connection.query('SELECT crest_commands.'+name+'('+parameters.join(',')+') AS result',request);
  assert.equal(result.state,'committed',name + ': ' + (result.reason ?? result.state));
  return result.receipt;
 };
 try{
  const expense=randomUUID(),payable=randomUUID();
  for(const [id,code,accountType,normalSide,controlKind,reportRole,name] of [
   [expense,'5098','expense','debit',null,'expense','Fictional supplies'],
   [payable,'2200','liability','credit','payable','payable','Fictional accounts payable'],
  ])await call('save_finance_account',[1,id,'0',{identity:{code,accountType,normalSide,controlKind,reportRole},name,active:true,reason:null}]);
  await call('approve_fixed_finance_mapping',['category_supplies','0',expense,day,'Fictional cost mapping reviewed']);
  await call('approve_fixed_finance_mapping',['payable','0',payable,day,'Fictional payable control reviewed']);
  await call('configure_fictional_invoice_setup',[{kind:'accounting_period',startsOn:day,reason:'Fictional period reviewed'}]);
  const {rows:[channel]}=await worker.query('SELECT channel_id,version::text,ownership_evidence,opening_on::text,opening_evidence FROM crest.money_channel_versions WHERE business_id=$1 AND kind=$2 AND opening_state=$3',
   [args[7],'bank','verified_zero']);
  assert(channel,'The fixture must provide a verified bank channel.');
  assert.equal(channel.version,'1');
  const {rows:[{tomorrow}]}=await worker.query('SELECT ($1::date+1)::text AS tomorrow',[day]);
  await call('save_money_channel',[channel.channel_id,'1',{
   identity:null,label:'Fictional checking after the payment',effectiveFrom:tomorrow,ownershipEvidence:channel.ownership_evidence,
   openingState:'verified_zero',openingOn:channel.opening_on,openingCents:'0',openingEvidence:channel.opening_evidence,
   active:true,reason:'Fictional subsequent bank channel review',
  }]);
  return {channelId:channel.channel_id};
 }finally{await finance.end();await worker.end();}
}
