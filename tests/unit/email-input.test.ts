import {it,expect} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {NullableText} from '../../src/app/customers/nullable-text';
it('shows an optional email input without a prerequisite checkbox',()=>{
 const html=renderToStaticMarkup(createElement(NullableText,{name:'email',label:'Email',limit:512,value:null,disabled:false,change:()=>{}}));
 expect(html).toContain('inputMode="email"');expect(html).toContain('autoComplete="email"');expect(html).toContain('name@example.com');expect(html).not.toContain('type="checkbox"');
});
it('preserves unusual original email text instead of imposing new browser validation',()=>{
 const html=renderToStaticMarkup(createElement(NullableText,{name:'email',label:'Email',limit:512,value:' Original <contact> ',disabled:true,change:()=>{throw Error('render must not edit');}}));
 expect(html).toContain('type="text"');expect(html).toContain(' Original &lt;contact&gt; ');expect(html).toContain('disabled');
});
