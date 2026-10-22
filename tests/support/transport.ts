import {IncomingMessage} from 'node:http';
import {Socket} from 'node:net';
import {transportFromIncomingMessage} from '../../src/security/trusted-transport.ts';

// Synthetic server metadata for unit tests only. Integration uses real sockets.
export function transportFixture({address='192.0.2.1',encrypted=true,headers=['Host','crest.example.com']}:{address?:string;encrypted?:boolean;headers?:string[]}={}){
  const socket=new Socket();
  Object.defineProperties(socket,{remoteAddress:{value:address},encrypted:{value:encrypted}});
  const message=new IncomingMessage(socket);message.rawHeaders=headers;
  return transportFromIncomingMessage(message);
}
