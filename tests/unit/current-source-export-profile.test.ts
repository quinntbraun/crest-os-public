import {it,expect} from 'vitest';
import {sourceExportProfileMatches} from '../../src/security/source-export-profile';
import {parseSourceExportCommitted,parseSourceExportCommand} from '../../src/security/source-export-job-contract';
import {sourceExportOwnerFixture} from '../support/source-export-owner-fixture';
it('accepts only versioned profile/schema pairs and refuses a differently labelled committed request',()=>{
 expect(sourceExportProfileMatches('crest.business-source-journal-bundle.v1',43)).toBe(true);expect(sourceExportProfileMatches('crest.current-business-source-bundle.v1',134)).toBe(true);expect(sourceExportProfileMatches('crest.current-business-source-bundle.v1',135)).toBe(true);expect(sourceExportProfileMatches('crest.current-business-source-bundle.v1',136)).toBe(true);expect(sourceExportProfileMatches('crest.current-business-source-bundle.v1',137)).toBe(true);expect(sourceExportProfileMatches('crest.current-business-source-bundle.v1',138)).toBe(true);
 for(const [profile,schema]of [['crest.business-source-journal-bundle.v1',134],['crest.current-business-source-bundle.v1',43],['crest.current-business-source-bundle.v1',133],['crest.current-business-source-bundle.v1',139]])expect(sourceExportProfileMatches(profile,schema)).toBe(false);
 expect(sourceExportProfileMatches('crest.current-business-source-bundle.v1',140)).toBe(true);expect(sourceExportProfileMatches('crest.current-business-source-bundle.v1',141)).toBe(false);expect(sourceExportProfileMatches('crest.business-source-journal-bundle.v1',140)).toBe(false);
 const f=sourceExportOwnerFixture(),command=parseSourceExportCommand({...f.original,reference:{...f.original.reference,profile:'crest.current-business-source-bundle.v1',sourceSchemaVersion:134}}),result={...f.committed,receipt:{...f.committed.receipt,command}};
 if(command.commandType!=='export.request')throw Error('Fixture must be an export request');
 expect(()=>parseSourceExportCommitted(result,command,f.actorId)).toThrow('SOURCE_EXPORT_COMMAND_REVIEW_REQUIRED');
 expect(parseSourceExportCommitted({...result,receipt:{...result.receipt,job:{...f.job,profile:command.reference.profile,source_schema_version:134}}},command,f.actorId).receipt.job.source_schema_version).toBe(134);
});
