import {it,expect,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {readNestedJsonBody,readFlatJsonBody,PrivateHttpError} from '../../src/security/private-http';
const request=(body:string)=>new Request('https://crest.example.com/api/business/quotes/save',{method:'POST',headers:{'content-type':'application/json'},body});
it('accepts ordered nested quote input without enabling nesting in the established flat reader',async()=>{
 const input={content:{title:'Synthetic "scope": clean',lines:[{id:'one',description:'é synthetic\nwork',amount:'100'},{id:'two',amount:'200'}]}};
 const parsed=await readNestedJsonBody(request(JSON.stringify(input)),['content']);expect(parsed).toEqual(input);expect(Object.isFrozen(parsed)).toBe(true);
 await expect(readFlatJsonBody(request(JSON.stringify(input)),['content'])).rejects.toThrow(PrivateHttpError);
});
it.each([
 '{"content":{"lines":[{"id":"one","id":"two"}]}}',
 '{"content":{"lines":[{"id":"one","\\u0069d":"two"}]}}',
 '{"content":{"amount":"100","amount":"200"}}',
 '{"content":{},"content":{"title":"replacement"}}'
])('rejects duplicate root or decoded nested keys rather than silently choosing a value: %s',async body=>{await expect(readNestedJsonBody(request(body),['content'])).rejects.toThrow(PrivateHttpError);});
it('refuses oversized/deep inputs and unexpected root fields before quote business logic',async()=>{
 await expect(readNestedJsonBody(request(JSON.stringify({content:'x'.repeat(131073)})),['content'])).rejects.toThrow(PrivateHttpError);
 let deep:unknown='value';for(let i=0;i<18;i++)deep=[deep];await expect(readNestedJsonBody(request(JSON.stringify({content:deep})),['content'])).rejects.toThrow(PrivateHttpError);
 await expect(readNestedJsonBody(request('{"content":{},"actorId":"untrusted"}'),['content'])).rejects.toThrow(PrivateHttpError);
 await expect(readNestedJsonBody(request('[]'),['content'])).rejects.toThrow(PrivateHttpError);
});
