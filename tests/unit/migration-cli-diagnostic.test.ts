import {it,expect} from 'vitest';
import {migrationCliDiagnostic} from '../../src/tooling/migration-cli-diagnostic';
const files=new Map([['20261028010000_service_catalog.sql',new TextEncoder().encode("RAISE EXCEPTION 'CREST_CATALOG_ROLE_REVIEW_REQUIRED';")]]);
it('retains only public snapshot identifiers and never raw private output or invented error codes',()=>{
 const secret='private-password-not-for-output',result=migrationCliDiagnostic(files,'Applying migration 20261028010000_service_catalog.sql','ERROR: CREST_CATALOG_ROLE_REVIEW_REQUIRED\npostgresql://owner:'+secret+'@localhost/db\nCREST_PRIVATE_VALUE_NOT_IN_SOURCE\nsecret SQL and user data');
 expect(result).toEqual({formatVersion:1,outcome:'failed_review_required',publicMigrationFiles:['20261028010000_service_catalog.sql'],publicErrorCodes:['CREST_CATALOG_ROLE_REVIEW_REQUIRED'],rawOutputRetained:false});expect(JSON.stringify(result)).not.toContain(secret);
});
it('does not report a partial identifier as an observed guard',()=>{expect(migrationCliDiagnostic(files,'','CREST_CATALOG_ROLE_REVIEW_REQUIRED_EXTRA').publicErrorCodes).toEqual([]);});
it('keeps an unclassified connection or process failure unclassified instead of retaining its cause',()=>{expect(migrationCliDiagnostic(files,'','connection failed for private-user with private-password')).toMatchObject({publicMigrationFiles:[],publicErrorCodes:[],rawOutputRetained:false});});
it('bounds scanned output and freezes returned identifiers',()=>{const result=migrationCliDiagnostic(files,'x'.repeat(256000),'CREST_CATALOG_ROLE_REVIEW_REQUIRED');expect(result.publicErrorCodes).toEqual([]);expect(Object.isFrozen(result)).toBe(true);expect(Object.isFrozen(result.publicErrorCodes)).toBe(true);});
