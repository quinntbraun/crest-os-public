import {randomUUID} from 'node:crypto';
import {it,expect,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {createProductionCapabilities,productionCapability} from '../../src/security/production-capabilities';
import {openingDocumentWorkerDatabase} from '../../src/security/session-database';
import {createOpeningDocumentDirectory,createOpeningDocumentDispatcher} from '../../src/bookkeeping/opening-document-directory';

it('requires explicit opening-document authority rather than ordinary supplier-original authority',()=>{
 const businessId=randomUUID(),grants=createProductionCapabilities({productionActivation:'ready'},businessId,['operationResolution','finance','supplierOriginals']);
 const config={environment:'production' as const,businessId,connectionString:'postgresql://web:fixture-only@database.example.com/crest',productionCapabilities:grants};
 expect(productionCapability(config,'openingDocuments')).toBe(false);
 expect(()=>openingDocumentWorkerDatabase(config)).toThrow('SESSION_DATABASE_CONFIGURATION_REQUIRED');
});
it('cannot open document SQL from unbundled source even with prospective composition permission',()=>{
 const businessId=randomUUID(),grants=createProductionCapabilities({productionActivation:'ready'},businessId,['operationResolution','finance','openingDocuments']);
 const config={environment:'production' as const,businessId,connectionString:'postgresql://web:fixture-only@database.example.com/crest',productionCapabilities:grants};
 const provider={} as Parameters<typeof createOpeningDocumentDirectory>[1],tokens={} as Parameters<typeof createOpeningDocumentDirectory>[2];
 expect(()=>createOpeningDocumentDirectory(config,provider,tokens,'postgresql://finance:fixture-only@database.example.com/crest')).toThrow('OPENING_DOCUMENT_AUTHORITY_REQUIRED');
 expect(()=>createOpeningDocumentDispatcher(config,provider,tokens,'postgresql://worker:fixture-only@database.example.com/crest',{} as Parameters<typeof createOpeningDocumentDispatcher>[4],{} as Parameters<typeof createOpeningDocumentDispatcher>[5])).toThrow('OPENING_DOCUMENT_AUTHORITY_REQUIRED');
});
