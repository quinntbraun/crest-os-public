import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {captureDirectoryOrigin,restoreDirectoryOrigin} from '../../src/client/directory-origin';

const node=(parent:HTMLElement|null=null)=>({isConnected:true,parentElement:parent,scrollHeight:0,clientHeight:0,scrollTop:0,focus:vi.fn(),scrollIntoView:vi.fn(),getBoundingClientRect:()=>({top:100,bottom:144})}) as unknown as HTMLElement;
let root:HTMLElement,scrollTo:ReturnType<typeof vi.fn>;
beforeEach(()=>{root=node();scrollTo=vi.fn();vi.stubGlobal('document',{documentElement:root,scrollingElement:root});vi.stubGlobal('window',{innerWidth:390,innerHeight:900,scrollY:642.6666666666666,scrollTo,getComputedStyle:(element:HTMLElement)=>({overflowY:element===root?'visible':'auto',scrollPaddingBlockEnd:'0px'})});});
afterEach(()=>vi.unstubAllGlobals());

it('restores exact fractional page and nested list positions with original control identity',()=>{
 const list=node(root);Object.assign(list,{scrollHeight:1800,clientHeight:500,scrollTop:251.5});const target=node(list),origin=captureDirectoryOrigin(target);list.scrollTop=0;
 expect(Object.isFrozen(origin)).toBe(true);expect(origin.containers).toHaveLength(1);restoreDirectoryOrigin(origin,null);
 expect(target.focus).toHaveBeenCalledWith({preventScroll:true});expect(list.scrollTop).toBe(251.5);expect(scrollTo).toHaveBeenCalledWith({top:642.6666666666666,behavior:'instant'});expect(target.scrollIntoView).not.toHaveBeenCalled();
});
it.each(['innerWidth','innerHeight'] as const)('leaves scroll placement to the browser after %s changes',key=>{
 const target=node(),origin=captureDirectoryOrigin(target);window[key]=500;restoreDirectoryOrigin(origin,null);expect(target.focus).toHaveBeenCalledWith({preventScroll:false});expect(scrollTo).not.toHaveBeenCalled();
});
it('uses a connected fallback without applying a removed record position',()=>{
 const target=node(),origin=captureDirectoryOrigin(target),fallback=node();Object.assign(target,{isConnected:false});restoreDirectoryOrigin(origin,fallback);expect(target.focus).not.toHaveBeenCalled();expect(fallback.focus).toHaveBeenCalledWith({preventScroll:false});expect(scrollTo).not.toHaveBeenCalled();
});
it('preserves a fractional viewport edge and reveals genuinely obscured controls',()=>{
 const target=node();target.getBoundingClientRect=()=>({top:856.453125,bottom:900.453125}) as DOMRect;const origin=captureDirectoryOrigin(target);restoreDirectoryOrigin(origin,null);expect(target.scrollIntoView).not.toHaveBeenCalled();target.getBoundingClientRect=()=>({top:901,bottom:945}) as DOMRect;restoreDirectoryOrigin(origin,null);expect(target.scrollIntoView).toHaveBeenCalledWith({block:'center',behavior:'instant'});
});
