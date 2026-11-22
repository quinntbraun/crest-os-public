import {createElement,isValidElement} from 'react';
import type {FunctionComponent,ReactNode} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {expect,it,vi} from 'vitest';
import ErrorScreen from '../../src/app/error';
import GlobalErrorScreen from '../../src/app/global-error';
import {WorkspaceRecovery} from '../../src/app/workspace-recovery';
import type {WorkspaceRecoveryBoundaryProps} from '../../src/app/workspace-recovery';

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

it('supplies accessible private document metadata when the root layout fails',()=>{
 const markup=renderToStaticMarkup(createElement(GlobalErrorScreen,{error:new Error('Synthetic root failure'),reset:()=>{}}));
 expect(markup).toContain('<title>Screen recovery · Crest OS</title>');
 expect(markup).toContain('lang="en"');
 expect(markup).toContain('name="viewport"');
 expect(markup).toContain('name="robots" content="noindex, nofollow"');
});

it('wires both boundaries to a fresh document instead of replaying the failed server result',async()=>{
 let reloads=0,localResets=0;
 vi.stubGlobal('window',{location:{reload:()=>{reloads++;}}});
 function action(node:ReactNode):(()=>void)|null{
  if(Array.isArray(node)){for(const child of node){const found=action(child);if(found)return found;}}
  if(isValidElement<{children?:ReactNode;reset?:()=>void}>(node)){
   if(node.type===WorkspaceRecovery)return node.props.reset??null;
   return action(node.props.children);
  }
  return null;
 }
 try{
  for(const Component of [ErrorScreen,GlobalErrorScreen]){
   const tree=await (Component as FunctionComponent<WorkspaceRecoveryBoundaryProps>)({error:new Error('Synthetic cached server result'),reset:()=>{localResets++;}});
   const reload=action(tree);expect(reload).not.toBeNull();reload!();
  }
  expect(reloads).toBe(2);expect(localResets).toBe(0);
 }finally{vi.unstubAllGlobals();}
});
