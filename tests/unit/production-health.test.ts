import {it,expect} from 'vitest';
import {healthTarget} from '../../src/server/health-check';
import {checkApplicationHealth} from '../../src/server/health-check';
import {createServer} from 'node:http';
import type {AddressInfo} from 'node:net';
it('retains the existing setup-shell health target',()=>{expect(healthTarget({})).toEqual({port:3000,secure:false,hostname:'127.0.0.1',host:'127.0.0.1:3000'});});
it('uses the private listener port and the public certificate identity for production health',()=>{
 expect(healthTarget({PORT:'8443',CREST_HEALTH_ORIGIN:'https://crest.example.com'})).toEqual({port:8443,secure:true,hostname:'crest.example.com',host:'crest.example.com'});
});
it.each(['0','-1','65536','3000/path','03'])('refuses an invalid health port %s',PORT=>{expect(()=>healthTarget({PORT})).toThrow();});
it.each(['http://crest.example.com','https://user:secret@crest.example.com','https://crest.example.com/other','https://crest.example.com?query=1'])('refuses ambiguous health origins',CREST_HEALTH_ORIGIN=>{expect(()=>healthTarget({CREST_HEALTH_ORIGIN})).toThrow();});
it.each([200,503])('checks the real loopback listener and requires status200, received %s',async status=>{
 const requests:string[]=[];
 const server=createServer((request,response)=>{requests.push(request.url??'');response.writeHead(status);response.end();});
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{
  const result=checkApplicationHealth({PORT:String((server.address() as AddressInfo).port)});
  if(status===200)await expect(result).resolves.toBeUndefined();else await expect(result).rejects.toThrow('APPLICATION_HEALTH_FAILED');
  expect(requests).toEqual(['/api/health']);
 }finally{await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
});
