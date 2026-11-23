import {readFileSync} from 'node:fs';
import {it,expect,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {operatorSourceInventory138} from '../../src/tooling/operator-source-inventory138.ts';
import {currentBusinessSourceInventory} from '../../src/security/current-business-source-inventory.ts';
import {currentIdentityInventory} from '../../src/security/current-business-identity-source.ts';
import {currentSessionSource} from '../../src/security/current-business-session-source.ts';
import {currentProviderSourceInventory} from '../../src/security/current-provider-source-inventory.ts';
it('accounts for exactly the ten reviewed138 operator-only sources outside the179 existing source components',()=>{
 const coverage=JSON.parse(readFileSync(new URL('../../planning/SECURITY_EXPORT_COVERAGE.json',import.meta.url),'utf8')) as {migrationCount:number;tables:{table:string;required:string[];excluded:{column:string}[]}[]};
 expect(coverage.migrationCount).toBe(138);const existing=[...currentBusinessSourceInventory,...currentIdentityInventory,currentSessionSource,...currentProviderSourceInventory].map(x=>x.source);
 expect(new Set(existing).size).toBe(179);const missing=coverage.tables.filter(table=>!existing.includes(table.table));expect(missing).toHaveLength(10);
 expect(new Set([...existing,...operatorSourceInventory138.map(x=>x.source)]).size).toBe(coverage.tables.length);
 for(const source of operatorSourceInventory138){const reviewed=missing.find(table=>table.table===source.source);expect(reviewed).toBeDefined();expect(source.columns).toEqual(reviewed!.required);expect([...source.excluded].sort()).toEqual(reviewed!.excluded.map(x=>x.column).sort());expect(source.source).toMatch(/^crest_private\.[a-z_]+$/);expect(source.columns.every(column=>/^[a-z_]+$/.test(column))).toBe(true);}
});
