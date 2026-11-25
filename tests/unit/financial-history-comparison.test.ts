import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {expect,it} from 'vitest';
import {FinanceHistoryComparison,FinanceHistoryComparisonValues,previousLoadedFinanceVersion} from '../../src/app/settings/accounts/history-comparison';

it('selects only the exact loaded predecessor without sorting, mutating or rounding versions',()=>{
 const rows=Object.freeze([{version:'9223372036854775807',name:'current'},{version:'9223372036854775805',name:'older gap'},{version:'9223372036854775806',name:'previous'}].map(row=>Object.freeze(row)));
 expect(previousLoadedFinanceVersion(rows,rows[0]!)).toBe(rows[2]);
 expect(previousLoadedFinanceVersion(rows.slice(0,2),rows[0]!)).toBeUndefined();
 expect(previousLoadedFinanceVersion(rows,{version:'1',name:'initial'})).toBeUndefined();
 expect(rows.map(row=>row.name)).toEqual(['current','older gap','previous']);
});

it('distinguishes first history from an unloaded predecessor and never substitutes a snapshot',()=>{
 for(const version of ['1','27']){
  const html=renderToStaticMarkup(createElement(FinanceHistoryComparisonValues,{version,fields:[{label:'Amount',before:'UNKNOWN_PRIVATE_BEFORE',after:'$10.25'}]}));
  expect(html).toContain(version==='1'?'This is the first saved version.':'The previous version is not in the loaded history.');
  expect(html).not.toContain('UNKNOWN_PRIVATE_BEFORE');expect(html).not.toContain('$10.25');expect(html).not.toContain('data-side=');
 }
});

it('keeps readable exact values, escaped evidence and explicit changed markers',()=>{
 const fields=Object.freeze([{label:'Amount',before:'$9,223,372,036,854,775.00',after:'$10.25'},{label:'Reason',before:'<img src=x onerror=alert(1)>',after:'<img src=x onerror=alert(1)>'}].map(row=>Object.freeze(row)));
 const html=renderToStaticMarkup(createElement(FinanceHistoryComparisonValues,{version:'2',previousVersion:'1',fields}));
 expect(html).toContain('Previous version 1');expect(html).toContain('this version 2');
 for(const value of ['$9,223,372,036,854,775.00','$10.25','&lt;img src=x onerror=alert(1)&gt;'])expect(html).toContain(value);
 expect(html).not.toContain('<img');
 expect(html.match(/class="financial-history-change"/g)).toHaveLength(1);
 expect(html.match(/data-side="before"/g)).toHaveLength(2);expect(html.match(/data-side="after"/g)).toHaveLength(2);
 expect(Object.isFrozen(fields)).toBe(true);
});

it('does not mount compared private values or duplicate history labels before the disclosure opens',()=>{
 const html=renderToStaticMarkup(createElement(FinanceHistoryComparison,{version:'2',previousVersion:'1',fields:[{label:'Account name',before:'PRIVATE_PREVIOUS_NAME',after:'PRIVATE_CURRENT_NAME'}]}));
 expect(html).toContain('<summary>Compare versions</summary>');
 expect(html).not.toMatch(/<details[^>]*\sopen(?:=|\s|>)/);
 for(const value of ['financial-history-comparison-content','PRIVATE_PREVIOUS_NAME','PRIVATE_CURRENT_NAME','data-side='])expect(html).not.toContain(value);
});
