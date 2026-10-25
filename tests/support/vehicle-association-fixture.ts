import {customerFixture,customerBusiness} from './customer-fixture.ts';
import {vehicleFixture} from './vehicle-fixture.ts';
import type {VehicleAssociationRow} from '../../src/customer/vehicle-association-contract.ts';
export function associationFixture(patch:Partial<VehicleAssociationRow>={}):VehicleAssociationRow{
  const customer=customerFixture();
  return {id:'99999999-9999-4999-8999-999999999999',business_id:customerBusiness,customer_id:customer.id,vehicle_id:vehicleFixture().id,valid_from:'2026-10-01T00:00:00.000000Z',valid_to:null,relationship:'owner',is_billing:true,evidence:null,close_reason:null,closed_at:null,closed_by:null,version:'1',created_at:customer.created_at,updated_at:customer.created_at,created_by:customer.created_by,updated_by:customer.created_by,origin:'manual',operation_id:vehicleFixture().operation_id,import_row_id:null,...patch};
}
