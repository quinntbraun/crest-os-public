import assert from 'node:assert/strict';
import {expect} from '@playwright/test';

// A real scrolled list, not artificial padding or a fabricated record.
export async function enterScrolledQuote(page,trigger){
 await trigger.focus();
 await trigger.evaluate(node=>{
  const top=node.getBoundingClientRect().top+window.scrollY;
  window.scrollTo({top:Math.max(1,top-150),behavior:'instant'});
 });
 const top=await page.evaluate(()=>window.scrollY);
 assert(top>0,'The real directory must have a nonzero return position');
 await trigger.press('Enter');
 return top;
}
export async function expectQuoteReturn(page,row,top){
 await expect(row).toBeFocused();
 await expect.poll(()=>row.evaluate(node=>{const r=node.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2;return x>=0&&y>=0&&x<innerWidth&&y<innerHeight&&node.contains(document.elementFromPoint(x,y));})).toBe(true);
 await expect.poll(async()=>Math.abs(await page.evaluate(()=>window.scrollY)-top)).toBeLessThanOrEqual(1);
}
