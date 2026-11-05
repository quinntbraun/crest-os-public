import {parseOriginalOperationReference} from '../../src/security/original-operation-reference.ts';
import type {QuoteCancellationEdit} from '../../src/commercial/quote-cancellation-edit-contract.ts';
/** Canonical test setup shared by pure and actual-SQL retirement cases. The
 * root has four fields; operation/epoch belong inside the six-field reference. */
export function quoteCancellationEditOriginalFixture(command:Pick<QuoteCancellationEdit,'businessId'|'operationId'|'recoveryEpoch'|'familyId'|'revisionId'|'expectedFamilyVersion'|'expectedRevisionVersion'>){
 return parseOriginalOperationReference({schemaVersion:1,businessId:command.businessId,commandType:'quote.draft.save',reference:{operationId:command.operationId,recoveryEpoch:command.recoveryEpoch,familyId:command.familyId,revisionId:command.revisionId,expectedFamilyVersion:command.expectedFamilyVersion,expectedRevisionVersion:command.expectedRevisionVersion}});
}
