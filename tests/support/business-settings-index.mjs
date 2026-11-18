import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

export async function reviewBusinessSettingsIndex(page,{label,finance,calendar}){
 const identity=page.getByRole('region',{name:'Business identity',exact:true});
 const directory=page.getByRole('navigation',{name:'Settings navigation',exact:true});
 const name=identity.getByRole('textbox',{name:'Business legal name',exact:true});
 await expect(name).toBeVisible();
 const before=await name.inputValue();
 await expect(directory.getByRole('heading',{name:'Workspace settings',exact:true})).toBeVisible();
 for(const heading of ['Business','Data and recovery','Device access'])await expect(directory.getByRole('heading',{name:heading,exact:true})).toHaveCount(1);
 await expect(directory.getByRole('heading',{name:'Finance',exact:true})).toHaveCount(finance?1:0);
 await expect(directory.getByRole('heading',{name:'Connections',exact:true})).toHaveCount(calendar?1:0);
 await expect(directory.getByRole('link',{name:'Fictional account setup',exact:true})).toHaveCount(finance?1:0);
 await expect(directory.getByRole('link',{name:'Google Calendar setup',exact:true})).toHaveCount(calendar?1:0);
 const current=directory.getByRole('link',{name:'Business identity',exact:true});
 await expect(current).toHaveAttribute('aria-current','location');
 await mkdir('.local/review',{recursive:true});
 for(const width of [360,390,768,1100,1440]){
  await page.setViewportSize({width,height:900});await page.evaluate(async()=>{await document.fonts.ready;scrollTo(0,0);});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'settings index must fit '+width);
  assert.deepEqual((await new AxeBuilder({page}).analyze()).violations.map(value=>value.id),[]);
  const small=await directory.locator('a').evaluateAll(nodes=>nodes.filter(node=>node.checkVisibility()).filter(node=>{const box=node.parentElement.getBoundingClientRect();return box.width<44||box.height<44;}).map(node=>node.textContent));
  assert.deepEqual(small,[]);
  await page.screenshot({path:join('.local/review','business-settings-index-'+label+'-'+width+'.png'),fullPage:true});
 }
 const draft='Synthetic unsaved settings navigation';
 await name.fill(draft);
 await expect(identity.getByRole('button',{name:'Save business name',exact:true})).toBeEnabled();
 let renames=0;const track=request=>{if(new URL(request.url()).pathname==='/api/business/rename')renames++;};page.on('request',track);
 try{await current.focus();await current.press('Enter');}
 finally{page.off('request',track);}
 await expect(page.getByRole('heading',{name:'Business identity',exact:true})).toBeFocused();
 assert.equal(await name.inputValue(),draft,'index navigation preserves the unsaved legal-name draft');
 assert.equal(renames,0,'index navigation does not submit the draft');
 await name.fill(before);
 await expect(identity.getByRole('button',{name:'Save business name',exact:true})).toBeDisabled();
 await page.setViewportSize({width:390,height:900});
}
