import {customerDate,customerInstant,customerUuid,exactCustomerObject as exact} from '../customer/customer-contract.ts';
import {moneyChannelCents} from './finance-money-channel-contract.ts';

type StatementRow=Readonly<{id:string;statementOn:string;signedCents:string}>;
type Movement=Readonly<{id:string;accountId:string;effectiveOn:string;signedCents:string;previouslyMatchedCents:string}>;
type Window=Readonly<{accountId:string;startsOn:string;endsOn:string;rows:readonly StatementRow[]}>;
const snapshotFields=['schemaVersion','businessId','statementId','accountId','startsOn','endsOn','movementFromOn',
 'observedAt','statementDifferenceCents','rows','movements'] as const;

function check(value:unknown):asserts value{
 if(!value)throw Error('STATEMENT_MATCH_REVIEW_REQUIRED');
}
function amount(value:unknown){
 check(moneyChannelCents(value));
 return BigInt(value);
}
function within(part:bigint,total:bigint){
 return total>0n?part>=0n&&part<=total:part<=0n&&part>=total;
}

export function parseStatementMatchSnapshot(value:unknown,businessId:string,statementId:string,requestedFrom:string|null){
 check(exact(value,snapshotFields)&&value.schemaVersion===1&&customerUuid(businessId)&&value.businessId===businessId
  &&customerUuid(statementId)&&value.statementId===statementId&&customerUuid(value.accountId)
  &&customerDate(value.startsOn)&&customerDate(value.endsOn)&&value.startsOn<=value.endsOn
  &&customerDate(value.movementFromOn)&&value.movementFromOn===(requestedFrom??value.startsOn)&&value.movementFromOn<=value.endsOn
  &&customerInstant(value.observedAt)&&typeof value.statementDifferenceCents==='string'
  &&/^(0|-?[1-9][0-9]{0,23})$/.test(value.statementDifferenceCents)
  &&Array.isArray(value.rows)&&value.rows.length<=10000&&Array.isArray(value.movements)&&value.movements.length<=1000);
 const {accountId,startsOn,endsOn,movementFromOn,statementDifferenceCents,observedAt}=value;
 const rows=value.rows.map((row:unknown):StatementRow=>{
  check(exact(row,['id','statementOn','signedCents'])&&customerUuid(row.id)&&customerDate(row.statementOn)
    &&row.statementOn>=startsOn&&row.statementOn<=endsOn&&moneyChannelCents(row.signedCents)&&row.signedCents!=='0');
  return {id:row.id,statementOn:row.statementOn,signedCents:row.signedCents};
 });
 const movements=value.movements.map((movement:unknown):Movement=>{
  check(exact(movement,['id','accountId','effectiveOn','signedCents','previouslyMatchedCents'])
    &&customerUuid(movement.id)&&movement.accountId===accountId&&customerDate(movement.effectiveOn)
    &&movement.effectiveOn>=movementFromOn&&movement.effectiveOn<=endsOn
    &&moneyChannelCents(movement.signedCents)&&movement.signedCents!=='0'&&movement.previouslyMatchedCents==='0');
  return {id:movement.id,accountId,effectiveOn:movement.effectiveOn,signedCents:movement.signedCents,
   previouslyMatchedCents:movement.previouslyMatchedCents};
 });
 check(new Set(rows.map(row=>row.id)).size===rows.length&&new Set(movements.map(movement=>movement.id)).size===movements.length);
 return {accountId,startsOn,endsOn,movementFromOn,statementDifferenceCents,observedAt,rows,movements};
}

/** Checks an explicit allocation against the statement and the authorized ledger snapshot. */
export function reviewStatementMatches(statement:Window,proposed:readonly unknown[],readMovement:(id:string)=>Movement|undefined){
 check(customerUuid(statement.accountId)&&customerDate(statement.startsOn)&&customerDate(statement.endsOn)
  &&statement.startsOn<=statement.endsOn);
 const rows=new Map<string,{on:string;total:bigint;allocated:bigint}>();
 for(const row of statement.rows){
  const total=amount(row.signedCents);
  check(customerUuid(row.id)&&!rows.has(row.id)&&customerDate(row.statementOn)
   &&row.statementOn>=statement.startsOn&&row.statementOn<=statement.endsOn&&total!==0n);
  rows.set(row.id,{on:row.statementOn,total,allocated:0n});
 }
 const movements=new Map<string,{source:Movement;total:bigint;allocated:bigint}>();
 const pairs=new Set<string>();
 for(const input of proposed){
  check(exact(input,['statementRowId','movementId','signedCents'])
   &&customerUuid(input.statementRowId)&&customerUuid(input.movementId));
  const key=input.statementRowId+':'+input.movementId;
  check(!pairs.has(key));
  pairs.add(key);
  const statementRow=rows.get(input.statementRowId);
  const signed=amount(input.signedCents);
  check(statementRow&&signed!==0n&&within(signed,statementRow.total)
   &&within(statementRow.allocated+signed,statementRow.total));
  let movement=movements.get(input.movementId);
  if(!movement){
   const source=readMovement(input.movementId);
   check(source&&source.id===input.movementId&&source.accountId===statement.accountId&&customerDate(source.effectiveOn));
   const total=amount(source.signedCents),prior=amount(source.previouslyMatchedCents);
   check(total!==0n&&within(prior,total));
   movement={source,total,allocated:prior};
   movements.set(source.id,movement);
  }
  check(movement.source.effectiveOn<=statementRow.on&&within(signed,movement.total)
   &&within(movement.allocated+signed,movement.total));
  statementRow.allocated+=signed;
  movement.allocated+=signed;
 }
 const outstanding=Array.from(rows,([rowId,row])=>({rowId,remainingCents:String(row.total-row.allocated)}))
  .filter(row=>row.remainingCents!=='0');
 return {state:outstanding.length?'unmatched_rows':'fully_allocated',outstanding} as const;
}
