// Private recovery metadata only. Existing HTTP/evidence parser bounds stay
// unchanged. All numeric metadata must be exact safe integers; money is text.
export function parseRecoveryJson(source:string,maximumBytes=8388608):unknown{
 function require(value:unknown):asserts value{if(!value)throw Error('RECOVERY_JSON_REVIEW_REQUIRED');}
 require(typeof source==='string'&&Number.isSafeInteger(maximumBytes)&&maximumBytes>0&&maximumBytes<=8388608&&Buffer.byteLength(source)<=maximumBytes&&Buffer.from(source,'utf8').toString('utf8')===source);
 let at=0,nodes=0;const space=()=>{while(at<source.length&&' \n\r\t'.includes(source[at]!))at++;};
 function string():string{
  require(source[at++]==='"');const start=at-1;
  while(at<source.length){const next=source.charCodeAt(at++);if(next===34){const value:unknown=JSON.parse(source.slice(start,at));require(typeof value==='string'&&!value.includes('\0')&&Buffer.from(value,'utf8').toString('utf8')===value);return value;}require(next>=32);if(next===92){const escape=source[at++];require(escape!==undefined&&'"\\/bfnrtu'.includes(escape));if(escape==='u'){require(/^[a-fA-F0-9]{4}$/.test(source.slice(at,at+4)));at+=4;}}}throw Error('RECOVERY_JSON_REVIEW_REQUIRED');
 }
 function value(depth:number):unknown{
  space();require(++nodes<=1000000&&depth<=32);const next=source[at];
  if(next==='"')return string();
  if(next==='{'){at++;space();const result:Record<string,unknown>={},names=new Set<string>();if(source[at]==='}'){at++;return Object.freeze(result);}for(;;){space();const name=string();require(!names.has(name)&&names.size<10000);names.add(name);space();require(source[at++]===':');Object.defineProperty(result,name,{value:value(depth+1),enumerable:true});space();const end=source[at++];if(end==='}')return Object.freeze(result);require(end===',');}}
  if(next==='['){at++;space();const result:unknown[]=[];if(source[at]===']'){at++;return Object.freeze(result);}for(;;){require(result.length<100000);result.push(value(depth+1));space();const end=source[at++];if(end===']')return Object.freeze(result);require(end===',');}}
  for(const [token,decoded]of [['null',null],['true',true],['false',false]] as const)if(source.startsWith(token,at)){at+=token.length;return decoded;}
  const match=/-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/y;match.lastIndex=at;const found=match.exec(source);require(found&&/^-?(?:0|[1-9][0-9]*)$/.test(found[0]));at=match.lastIndex;const decoded:unknown=JSON.parse(found[0]);require(typeof decoded==='number'&&Number.isSafeInteger(decoded)&&!Object.is(decoded,-0));return decoded;
 }
 const result=value(0);space();require(at===source.length);return result;
}
