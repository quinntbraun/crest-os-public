const id=(n:number)=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
export const recreditIds={business:id(1),customer:id(2),failure:id(3),payment:id(4),component:id(5),tip:id(6),channel:id(7),epoch:id(8),operation:id(9),settlement:id(10)};
export const recreditOptionsArgs=[recreditIds.business,recreditIds.customer,recreditIds.failure,'2026-11-19'] as const;
export function recreditOptionsFixture(metadata=false,tip=false){
 const component={failureComponentId:recreditIds.component,sourceKind:tip?'tip':'funds',originalReceivableId:null,
  originalInvoiceNumber:null,receivableCapacityCents:null,availableRanges:[{firstCent:'1',lastCent:'10'}]};
 return {state:'ready',schemaVersion:1,businessId:recreditIds.business,customerId:recreditIds.customer,
  failureId:recreditIds.failure,originalPaymentId:recreditIds.payment,failedOn:'2026-11-18',actualOn:'2026-11-19',
  openPeriod:true,fundsMapping:null,components:metadata?[{...component,tipReinstatement:tip?{
   originalTipRealizationId:recreditIds.tip,originalNetCents:'10',originalTaxCents:'0',taxProfileId:null}:null}]:[component],
  channels:[{channelId:recreditIds.channel,version:'1',label:'Fictional bank',kind:'bank'}]};
}
