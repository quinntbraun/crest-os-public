import 'server-only';
import {isIP} from 'node:net';

// Literal addresses only; equivalent IPv4-mapped IPv6 shares the same budget.
export function normalizeClientAddress(value:string):string{
  if(typeof value!=='string'||value.length>45)throw new Error('CLIENT_ADDRESS_INVALID');
  if(isIP(value)===4)return value;
  if(isIP(value)!==6)throw new Error('CLIENT_ADDRESS_INVALID');
  const canonical=new URL(`http://[${value}]/`).hostname.slice(1,-1);
  const mapped=/^::ffff:([a-f0-9]{1,4}):([a-f0-9]{1,4})$/.exec(canonical);
  if(!mapped)return canonical;
  const high=parseInt(mapped[1]!,16),low=parseInt(mapped[2]!,16);
  return [high>>>8,high&255,low>>>8,low&255].join('.');
}
