import {randomUUID} from 'node:crypto';
import {leadFixture} from './lead-fixture.ts';
import type {LeadEvent} from '../../src/customer/lead-state-contract.ts';
export function leadStateEventFixture(patch:Partial<LeadEvent>={}):LeadEvent{
 const lead=leadFixture();return {id:randomUUID(),business_id:lead.business_id,lead_id:lead.id,lead_version:'2',from_state:'new',to_state:'lost',reason:' Original reason é 😀\n retained ',effective_at:lead.updated_at,quote_send_id:null,acceptance_id:null,version:'1',created_at:lead.updated_at,updated_at:lead.updated_at,created_by:lead.updated_by,updated_by:lead.updated_by,origin:'manual',operation_id:randomUUID(),import_row_id:null,...patch};
}
