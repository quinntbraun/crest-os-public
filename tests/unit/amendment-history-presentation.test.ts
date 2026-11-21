import {it,expect} from 'vitest';
import {createHash} from 'node:crypto';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {amendmentHistoryFixture} from './quote-amendment-history-fixture';
import {prepareQuoteReviewContent} from '../../src/commercial/quote-review-content';
import {quoteInputFromSnapshots} from '../../src/commercial/quote-storage-contract';
import {parseQuoteAmendmentRead} from '../../src/commercial/quote-amendment-read';
import {AmendmentHistoryEvents} from '../../src/app/quotes/amendments/history';

it('preserves each retained version’s date across a later time-zone edit and keeps exact evidence',async()=>{
 const f=await amendmentHistoryFixture(2),packet=structuredClone(f.packet),at='2026-11-18T00:15:30.123456Z';
 let before:typeof packet.revision|null=null;
 for(const [index,event] of packet.history.entries()){
  const timezone=index===0?'America/New_York':'Asia/Tokyo';
  const content=quoteInputFromSnapshots(event.after.customer_safe_snapshot,event.after.internal_snapshot),prepared=prepareQuoteReviewContent({...content,timezone});
  const after={...event.after,timezone,updated_at:at,customer_safe_snapshot:prepared.customer,internal_snapshot:prepared.internal,canonical_content:prepared.canonical,content_hash:createHash('sha256').update(prepared.canonical).digest('hex')};
  packet.history[index]={...event,at,before,after};before=after;
 }
 packet.revision=packet.history.at(-1)!.after;
 const read=await parseQuoteAmendmentRead(packet,f.request);if('state'in read)throw Error('saved history required');
 const source=JSON.stringify(read.history),html=renderToStaticMarkup(createElement(AmendmentHistoryEvents,{events:read.history}));
 const recorded=[...html.matchAll(/Recorded <time[^>]*>([^<]+)<\/time>/g)].map(match=>match[1]);
 expect(recorded).toHaveLength(2);
 expect(recorded[0]).toContain('Nov 17, 2026');expect(recorded[0]).toContain('7:15:30 PM');expect(recorded[0]).toContain('EST');
 expect(recorded[1]).toContain('Nov 18, 2026');expect(recorded[1]).toContain('9:15:30 AM');
 for(const text of [at,'America/New_York','Asia/Tokyo',...read.history.flatMap(event=>[event.eventId,event.actorId,event.operationId])])expect(html).toContain(text);
 expect(html).not.toContain('PRIVATE_SYNTHETIC');expect(JSON.stringify(read.history)).toBe(source);
});
