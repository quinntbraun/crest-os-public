// Internal bounded evidence reader; no I/O or application authorization.
function require(value:unknown):asserts value{if(!value)throw new Error('EVIDENCE_JSON_REVIEW_REQUIRED');}
function text(value:string,max:number){return value.length<=max&&!value.includes('\0')&&Buffer.byteLength(value,'utf8')<=max&&Buffer.from(value,'utf8').toString('utf8')===value;}

// Bounded JSON grammar, with duplicate decoded names rejected in every object.
// Decode individual scalar tokens with JSON.parse; never reserialize evidence.
export function parseEvidenceJson(source:string,exactIntegers=false):unknown{
  const maxText=Buffer.byteLength(source,'utf8');let at=0,nodes=0;
  const space=()=>{while(at<source.length&&' \t\r\n'.includes(source[at]!))at++;};
  function string():string{
    require(source[at]==='"');const start=at++;
    while(at<source.length){
      const c=source.charCodeAt(at++);
      if(c===34){const value:unknown=JSON.parse(source.slice(start,at));require(typeof value==='string'&&text(value,maxText));return value;}
      require(c>=32);
      if(c===92){const escape=source[at++];require(escape!==undefined&&'"\\/bfnrtu'.includes(escape));if(escape==='u'){require(/^[a-fA-F0-9]{4}$/.test(source.slice(at,at+4)));at+=4;}}
    }
    throw new Error('EVIDENCE_JSON_REVIEW_REQUIRED');
  }
  function value(depth:number):unknown{
    space();require(++nodes<=10000&&depth<=4);const c=source[at];
    if(c==='"')return string();
    if(c==='{'){
      at++;space();const result:Record<string,unknown>=Object.create(null),names=new Set<string>();
      if(source[at]==='}'){at++;return result;}
      for(;;){space();const name=string();require(!names.has(name)&&names.size<32);names.add(name);space();require(source[at++]===':');result[name]=value(depth+1);space();const next=source[at++];if(next==='}')return result;require(next===',');}
    }
    if(c==='['){
      at++;space();const result:unknown[]=[];if(source[at]===']'){at++;return result;}
      for(;;){require(result.length<1000);result.push(value(depth+1));space();const next=source[at++];if(next===']')return result;require(next===',');}
    }
    for(const [token,decoded] of [['null',null],['true',true],['false',false]] as const)if(source.startsWith(token,at)){at+=token.length;return decoded;}
    const number=/-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/y;number.lastIndex=at;const match=number.exec(source);require(match);at=number.lastIndex;
    const decoded:unknown=JSON.parse(match[0]);require(typeof decoded==='number'&&Number.isFinite(decoded));
    if(exactIntegers&&!Number.isSafeInteger(decoded)){require(/^-?(?:0|[1-9][0-9]*)$/.test(match[0]));return BigInt(match[0]);}return decoded;
  }
  const result=value(0);space();require(at===source.length);return result;
}
