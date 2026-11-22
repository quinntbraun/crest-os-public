import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {expect,it} from 'vitest';
import ErrorScreen from '../../src/app/error';
import GlobalErrorScreen from '../../src/app/global-error';

it('keeps exception details private and offers explicit screen recovery and original-save review',()=>{
 const error=Object.assign(new Error('Synthetic private customer detail'),{digest:'synthetic-internal-digest'});
 for(const Component of [ErrorScreen,GlobalErrorScreen]){
  let calls=0;
  const markup=renderToStaticMarkup(createElement(Component,{error,reset:()=>{calls++;}}));
  expect(markup).not.toContain(error.message);
  expect(markup).not.toContain(error.digest);
  expect(markup).toContain('type="button"');
  expect(markup).toContain('Reload screen');
  expect(markup).toContain('href="/save-review"');
  expect(markup).toContain('href="/"');
  expect(markup).toContain('check the original outcome');
  expect(calls).toBe(0);
 }
});
