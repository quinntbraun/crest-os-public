import {request as httpRequest} from 'node:http';
import {request as httpsRequest} from 'node:https';
import {isIP} from 'node:net';
import {checkServerIdentity} from 'node:tls';

export function healthTarget(environment:Readonly<{PORT?:string;CREST_HEALTH_ORIGIN?:string}>){
 const port=environment.PORT??'3000';
 if(!/^[1-9]\d{0,4}$/.test(port)||Number(port)>65535)throw new Error('APPLICATION_HEALTH_CONFIGURATION_REQUIRED');
 const raw=environment.CREST_HEALTH_ORIGIN;
 if(raw===undefined)return {port:Number(port),secure:false as const,hostname:'127.0.0.1',host:'127.0.0.1:'+port};
 const origin=new URL(raw);
 if(origin.origin!==raw||origin.protocol!=='https:'||origin.username||origin.password)throw new Error('APPLICATION_HEALTH_CONFIGURATION_REQUIRED');
 return {port:Number(port),secure:true as const,hostname:origin.hostname.replace(/^\[|\]$/g,''),host:origin.host};
}
export async function checkApplicationHealth(environment:Parameters<typeof healthTarget>[0]){
 const target=healthTarget(environment);
 await new Promise<void>((resolve,reject)=>{
  // Connect to this process on loopback. A public hostname supplies only the
  // Host/SNI/certificate identity; it never redirects the probe to another host.
  const options={hostname:'127.0.0.1',port:target.port,path:'/api/health',method:'GET',headers:{host:target.host},timeout:3000};
  const response=(incoming:import('node:http').IncomingMessage)=>{
   incoming.resume();
   if(incoming.statusCode===200)resolve();else reject(new Error('APPLICATION_HEALTH_FAILED'));
  };
  const request=target.secure?httpsRequest({...options,servername:isIP(target.hostname)?'':target.hostname,
   rejectUnauthorized:true,checkServerIdentity:(_name,certificate)=>checkServerIdentity(target.hostname,certificate)},response):httpRequest(options,response);
  request.on('error',()=>reject(new Error('APPLICATION_HEALTH_FAILED')));
  request.on('timeout',()=>request.destroy(new Error('APPLICATION_HEALTH_FAILED')));
  request.end();
 });
}
