import {expect,it} from 'vitest';
import {groupedRecreditOptionsForCapability,parseGroupedRecreditOptions} from '../../src/bookkeeping/collection-failure-grouped-recredit-contract';
import {recreditIds,recreditOptionsArgs as args,recreditOptionsFixture as fixture} from '../support/grouped-recredit-options';

it('preserves the exact legacy reader contract when restored-tip writes are disabled',()=>{
 const value=fixture();expect(groupedRecreditOptionsForCapability(value,...args,false)).toEqual(value);
 expect(parseGroupedRecreditOptions(value,...args,false).state).toBe('ready');
});
it('validates the newer reader and returns the closed legacy browser contract without mutating source',()=>{
 const value=fixture(true),before=structuredClone(value);
 expect(()=>parseGroupedRecreditOptions(value,...args,false)).toThrow();
 const response=groupedRecreditOptionsForCapability(value,...args,false);
 expect(response).toEqual(fixture());expect(value).toEqual(before);
 expect(parseGroupedRecreditOptions(response,...args,false).state).toBe('ready');
});
it('preserves original failed-tip ranges without exposing restored-tip treatment when disabled',()=>{
 const value=fixture(true,true),response=groupedRecreditOptionsForCapability(value,...args,false);
 expect(response).toEqual(fixture(false,true));
 const parsed=parseGroupedRecreditOptions(response,...args,false);
 expect(parsed.state==='ready'&&parsed.components[0]).toMatchObject({sourceKind:'tip',tipReinstatement:null,availableRanges:[{firstCent:'1',lastCent:'10'}]});
});
it('retains validated tip lineage only for the enabled browser contract',()=>{
 const value=fixture(true,true),response=groupedRecreditOptionsForCapability(value,...args,true);
 expect(response).toEqual(value);const parsed=parseGroupedRecreditOptions(response,...args,true);
 expect(parsed.state==='ready'&&parsed.components[0]?.tipReinstatement).toMatchObject({originalTipRealizationId:recreditIds.tip,originalNetCents:'10',originalTaxCents:'0'});
 expect(()=>groupedRecreditOptionsForCapability(fixture(),...args,true)).toThrow();
});
const modern=fixture(true),row=modern.components[0]!;
it.each([
 {...modern,businessId:recreditIds.customer},
 {...modern,actualOn:'2026-11-18'},
 {...modern,schemaVersion:2},
 {...modern,unexpected:true},
 {...modern,components:[{...row,unexpected:true}]},
 {...modern,components:[{...row,tipReinstatement:{originalTipRealizationId:recreditIds.tip,originalNetCents:'10',originalTaxCents:'0',taxProfileId:null}}]},
 {...modern,components:[{...row,sourceKind:'tip',tipReinstatement:{originalTipRealizationId:recreditIds.tip,originalNetCents:'10',originalTaxCents:'0',taxProfileId:null,unexpected:true}}]},
 {...modern,components:[{...row,availableRanges:[{firstCent:'10',lastCent:'1'}]}]},
])('rejects mismatched or malformed data before projecting any field',value=>{
 expect(()=>groupedRecreditOptionsForCapability(value,...args,false)).toThrow();
});
it('rejects mixed reader revisions instead of silently filling missing metadata',()=>{
 const legacy=fixture().components[0]!;
 expect(()=>groupedRecreditOptionsForCapability({...modern,components:[row,{...legacy,failureComponentId:recreditIds.tip,availableRanges:[{firstCent:'11',lastCent:'20'}]}]},...args,false)).toThrow();
});
it.each([false,true])('preserves absence without inventing options with tip capability %s',enabled=>{
 expect(groupedRecreditOptionsForCapability({state:'absent'},...args,enabled)).toEqual({state:'absent'});
});
