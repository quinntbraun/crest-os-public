import assert from 'node:assert/strict';
import {expect} from '@playwright/test';

export async function assertActiveWorkLayout(page,width,state){
 const form=page.locator('.active-work-form'),visit=form.locator('.field-visit-strip');
 await expect(visit.locator('.field-visit-state strong')).toHaveText(state);
 const details=visit.getByRole('button',{name:'View visit details',exact:true});
 const facts=visit.locator('.field-visit-facts');
 const summary=await visit.boundingBox(),action=await form.locator('.field-next-action').boundingBox();
 assert(summary&&action);
 if(width>=930){
  await expect(details).toBeHidden();await expect(facts).toBeVisible();
  assert(summary.x+summary.width<=action.x,'desktop saved visit stays beside the next action');
  assert(Math.abs(summary.y-action.y)<1,'desktop saved context aligns with the action');
 }else{
  await expect(details).toHaveAttribute('aria-expanded','false');await expect(facts).toBeHidden();
  assert(summary.y+summary.height<=action.y,'compact phone strip precedes its next action');
  assert(summary.height<190,'collapsed visit context leaves room for the next field');
  const fields=form.locator('.field-next-action :is(input,select,textarea):visible');
  const next=await fields.count()?fields.first():form.locator('.field-next-action button[type="submit"]');
  const box=await next.boundingBox();assert(box);
  assert(box.y+box.height<=page.viewportSize().height-72,'next field/action is within the initial phone viewport above navigation');
 }
}
