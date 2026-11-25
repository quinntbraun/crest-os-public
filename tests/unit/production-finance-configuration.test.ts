import {it,expect,vi} from 'vitest';
it('requires explicit worksheet prerequisites for opening deposit evidence',()=>{
 expect(financeRuntimeFeatures(['moneyChannels','openingWorksheet','openingFunds'])).toMatchObject({openingFunds:true});
 expect(()=>financeRuntimeFeatures(['openingFunds'])).toThrow('PRODUCTION_FINANCE_CONFIGURATION_REQUIRED');
 expect(validateFinanceRuntimeFeatures({})).not.toHaveProperty('openingFunds');
});
vi.mock('server-only',()=>({}));
import {financeRuntimeFeatureNames,financeRuntimeFeatures,validateFinanceRuntimeFeatures,validateFinanceRuntimeConnection,validateFinanceRuntimeDependencies} from '../../src/bookkeeping/finance-runtime-configuration';
import {productionFinanceDatabase,financePreviewDatabase} from '../../src/security/session-database';
import {createProductionCapabilities} from '../../src/security/production-capabilities';
import {randomUUID} from 'node:crypto';

it('accepts existing complete finance modes without creating a connection or accepting any financial event',()=>{
 const value=financeRuntimeFeatures(financeRuntimeFeatureNames);
 expect(Object.keys(value)).toHaveLength(financeRuntimeFeatureNames.length);expect(Object.isFrozen(value)).toBe(true);
 expect(financeRuntimeFeatures([])).toEqual({});
});
it('rejects unknown uploads, duplicate modes, malformed flags and incomplete posting dependencies',()=>{
 for(const value of [['supplierOriginalUploads'],['fixedMappings','fixedMappings'],['invoiceIssue'],['statementMatchDrafts'],['collectionFailureTipReinstatements'],['unregistered']])expect(()=>financeRuntimeFeatures(value)).toThrow('PRODUCTION_FINANCE_CONFIGURATION_REQUIRED');
 for(const value of [null,[],{moneyChannels:'true'},{unknown:true}])expect(()=>validateFinanceRuntimeFeatures(value)).toThrow('PRODUCTION_FINANCE_CONFIGURATION_REQUIRED');
});
it('retains the existing completion/expense runtime prerequisites',()=>{
 expect(()=>validateFinanceRuntimeDependencies(financeRuntimeFeatures(['invoicePreparation']),()=>false)).toThrow();
 expect(()=>validateFinanceRuntimeDependencies(financeRuntimeFeatures(financeRuntimeFeatureNames),name=>name==='jobCompletion')).toThrow();
 expect(()=>validateFinanceRuntimeDependencies(financeRuntimeFeatures(financeRuntimeFeatureNames),()=>true)).not.toThrow();
});
it('requires the same database through a distinct finance login without insecure connection options',()=>{
 const web='postgresql://crest_web_login:fixture-only@database.example.com/crest',finance='postgresql://crest_finance_login:fixture-only@database.example.com/crest';
 expect(()=>validateFinanceRuntimeConnection(web,finance)).not.toThrow();
 for(const value of [web,web.replace('crest_web_login','%63rest_web_login'),finance.replace(/\/crest$/,'/different'),finance.replace('database.example.com','other.example.com'),finance+'?sslmode=disable'])expect(()=>validateFinanceRuntimeConnection(web,value)).toThrow('PRODUCTION_FINANCE_CONFIGURATION_REQUIRED');
});
it('keeps the historical preview adapter test-only and production finance separately capability-gated',()=>{
 const businessId=randomUUID(),connectionString='postgresql://crest_finance_login:fixture-only@database.example.com/crest';
 expect(()=>financePreviewDatabase({environment:'production',connectionString})).toThrow('SESSION_DATABASE_CONFIGURATION_REQUIRED');
 expect(()=>productionFinanceDatabase({environment:'production',connectionString,businessId})).toThrow('SESSION_DATABASE_CONFIGURATION_REQUIRED');
 const grant=createProductionCapabilities({productionActivation:'ready'},businessId,['operationResolution','finance']);
 expect(productionFinanceDatabase({environment:'production',connectionString,businessId,productionCapabilities:grant})).toBeTypeOf('function');
 expect(()=>productionFinanceDatabase({environment:'production',connectionString,businessId:randomUUID(),productionCapabilities:grant})).toThrow('SESSION_DATABASE_CONFIGURATION_REQUIRED');
});
