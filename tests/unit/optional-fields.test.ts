import {it,expect} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {NullableText} from '../../src/app/customers/nullable-text';
import {FollowUpInput} from '../../src/app/leads/follow-up-input';

it('renders unknown optional text immediately, with a visible label and no presence checkbox',()=>{
 const html=renderToStaticMarkup(createElement(NullableText,{name:'make',label:'Make',limit:200,value:null,disabled:false,change:()=>{throw Error('Rendering must not modify saved data');}}));
 expect(html).toContain('<label for="make">Make</label>');expect(html).toContain('id="make"');expect(html).toContain('value=""');expect(html).not.toContain('checkbox');expect(html).not.toContain('required');
});
it('opening a historical explicitly empty value does not rewrite it as unknown',()=>{
 const html=renderToStaticMarkup(createElement(NullableText,{name:'notes',label:'Notes',limit:2000,value:'',multiline:true,disabled:true,change:()=>{throw Error('Historical source must remain unchanged');}}));
 expect(html).toContain('textarea');expect(html).toContain('disabled');expect(html).not.toContain('checkbox');
});
it('allows an absent follow-up without a required date or an enable checkbox',()=>{
 const html=renderToStaticMarkup(createElement(FollowUpInput,{value:null,change:()=>{throw Error('Rendering must not invent a follow-up');}}));
 expect(html).toContain('type="datetime-local"');expect(html).not.toContain('required');expect(html).not.toContain('checkbox');
});
