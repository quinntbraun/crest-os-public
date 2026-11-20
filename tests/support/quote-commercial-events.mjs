import assert from 'node:assert/strict';
import {expect} from '@playwright/test';

export async function reviewCommercialEventEvidence(panel){
 const history=panel.getByRole('region',{name:'Key saved events',exact:true});
 const zone=(await history.locator(':scope > p').innerText()).match(/Times shown in ([^;]+);/)?.[1];
 assert(zone,'The event time zone must be explicit');
 const format=new Intl.DateTimeFormat('en-US',{dateStyle:'medium',timeStyle:'short',timeZone:zone});
 const rows=history.locator('ol > li');
 await expect(rows).toHaveCount(4);
 const labels=['Document approved','Last actual sharing','Customer confirmation','Recorded in Crest'];
 for(let i=0;i<labels.length;i++){
  const row=rows.nth(i),visible=row.locator(':scope > time'),exact=row.locator('details time');
  await expect(row.locator(':scope > strong')).toHaveText(labels[i]);
  const instant=await visible.getAttribute('datetime');
  assert.match(instant,/^\d{4}-\d{2}-\d{2}T/);
  await expect(visible).toHaveText(format.format(new Date(instant)));
  const disclosure=row.locator(':scope > details');
  await expect(exact).toBeHidden();
  await disclosure.locator(':scope > summary').click();
  await expect(exact).toBeVisible();
  await expect(exact).toHaveAttribute('datetime',instant);
  await expect(exact).toHaveText(instant);
  await disclosure.locator(':scope > summary').click();
 }
 await expect(rows.first().locator('dt',{hasText:'Approved by reference'})).toHaveCount(1);
 // Approval exposes an actual actor reference. Sharing/acceptance do not
 // expose an operator identity; the UI must not invent one from a customer.
 await expect(rows.nth(1).getByText('Approved by reference',{exact:true})).toHaveCount(0);
 await expect(rows.nth(3)).toContainText('Recording time is separate from when the customer confirmed.');
}
