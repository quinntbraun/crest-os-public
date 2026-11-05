import {describe,it,expect} from 'vitest';
import {draftChanged} from '../../src/client/draft-changed';
import {emptyCustomerDraft} from '../../src/client/customer-editor-controller';
import {emptyVehicleDraft} from '../../src/client/vehicle-editor-controller';

describe('protect unsaved CRM editing intent independently of save validity',()=>{
 it('does not warn for a closed editor, untouched blank form or unchanged saved draft',()=>{
  expect(draftChanged(null,emptyCustomerDraft)).toBe(false);expect(draftChanged({...emptyCustomerDraft},emptyCustomerDraft)).toBe(false);
  const saved={...emptyCustomerDraft,displayName:'Synthetic customer',phone:'5555550123'};expect(draftChanged({...saved},saved)).toBe(false);expect(draftChanged({...emptyVehicleDraft},emptyVehicleDraft)).toBe(false);
 });
 it('protects an invalid cleared name instead of treating a disabled save as no changes',()=>{
  const saved={...emptyCustomerDraft,displayName:'Synthetic customer'};expect(draftChanged({...saved,displayName:''},saved)).toBe(true);expect(draftChanged({...emptyCustomerDraft,phone:'123'},emptyCustomerDraft)).toBe(true);
 });
 it('preserves explicit empty, unknown, opt-out and archive editing distinctions',()=>{
  expect(draftChanged({...emptyCustomerDraft,notes:''},emptyCustomerDraft)).toBe(true);expect(draftChanged({...emptyCustomerDraft,outreachOptOut:true},emptyCustomerDraft)).toBe(true);expect(draftChanged({...emptyCustomerDraft,archived:true,archiveReason:''},emptyCustomerDraft)).toBe(true);
 });
 it('protects an invalid vehicle year even though JSON serialization conflates NaN with null',()=>{
  expect(draftChanged({...emptyVehicleDraft,year:NaN},emptyVehicleDraft)).toBe(true);expect(draftChanged({...emptyVehicleDraft,label:' '},emptyVehicleDraft)).toBe(true);expect(draftChanged({...emptyVehicleDraft,make:''},emptyVehicleDraft)).toBe(true);
 });
 it('stops warning when the owner restores all original field values',()=>{
  const saved={...emptyVehicleDraft,label:'Synthetic van',year:2022,notes:'Original'};expect(draftChanged({...saved,year:2023},saved)).toBe(true);expect(draftChanged({...saved},saved)).toBe(false);
 });
});
