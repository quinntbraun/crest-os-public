import {it,expect} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {NullableText} from '../../src/app/customers/nullable-text';
it('shows an optional telephone input immediately for an unknown number',()=>{
 const html=renderToStaticMarkup(createElement(NullableText,{name:'phone',label:'Phone',limit:512,value:null,disabled:false,change:()=>{}}));
 expect(html).toContain('type="tel"');expect(html).toContain('inputMode="tel"');expect(html).toContain('autoComplete="tel"');expect(html).toContain('+1 (555) 555-0123');expect(html).not.toContain('type="checkbox"');
});
it('presents a known country code and extension while preserving the original input outside the component',()=>{
 const raw='+1 2025550123 ext. 7',html=renderToStaticMarkup(createElement(NullableText,{name:'phone',label:'Phone',limit:512,value:raw,disabled:false,change:()=>{throw Error('render must never change the raw value');}}));
 expect(html).toContain('+1 (202) 555-0123 ext. 7');expect(raw).toBe('+1 2025550123 ext. 7');
});
