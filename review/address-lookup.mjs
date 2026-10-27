// Fixed, low-volume review-only Photon adapter. No production provider activation.
const hasControls=value=>[...value].some(c=>c.codePointAt(0)<32||c.codePointAt(0)===127);
export function createReviewAddressLookup(request=fetch){
 let busy=false,last=0,day='',count=0;const cache=new Map();
 return async input=>{
  if(!input||typeof input.query!=='string'||input.query.trim().length<4||input.query.length>200||typeof input.area!=='string'||input.area.length>100||Object.keys(input).some(k=>!['query','area','near'].includes(k))||hasControls(input.query+input.area))throw Error('ADDRESS_SEARCH_INPUT_INVALID');
  const near=input.near;if(near!==null&&(!near||Object.keys(near).length!==2||!Number.isFinite(near.lat)||Math.abs(near.lat)>90||!Number.isFinite(near.lon)||Math.abs(near.lon)>180))throw Error('ADDRESS_SEARCH_INPUT_INVALID');
  const key=JSON.stringify(input),now=Date.now(),cached=cache.get(key);if(cached&&now-cached.at<60000)return structuredClone(cached.value);
  if(day!==new Date().toISOString().slice(0,10)){day=new Date().toISOString().slice(0,10);count=0;}
  if(busy||now-last<1000||count>=300)throw Error('ADDRESS_SEARCH_LIMITED');
  busy=true;last=now;count++;
  try{
   const url=new URL('https://photon.komoot.io/api/');url.searchParams.set('q',[input.query.trim(),input.area.trim()].filter(Boolean).join(', '));url.searchParams.set('limit','5');url.searchParams.set('lang','en');
   if(near){url.searchParams.set('lat',String(Math.round(near.lat*100)/100));url.searchParams.set('lon',String(Math.round(near.lon*100)/100));}
   const signal=AbortSignal.timeout(7000),response=await request(url,{signal,redirect:'error',headers:{accept:'application/json','user-agent':'CrestOS-SampleReview/1.0 (low-volume interactive address suggestions)'}});
   if(!response.ok||!response.headers.get('content-type')?.includes('json'))throw Error();
   const reader=response.body?.getReader();if(!reader)throw Error();const chunks=[];let size=0;
   try{for(;;){const part=await reader.read();if(part.done)break;if((size+=part.value.length)>65536)throw Error();chunks.push(part.value);}}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
   const raw=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));if(!Array.isArray(raw.features)||raw.features.length>10)throw Error();
   const text=(v,n=200)=>typeof v==='string'&&v.length<=n&&!hasControls(v)?v:null;
   const suggestions=raw.features.flatMap(f=>{
    const p=f?.properties,g=f?.geometry;if(!p||g?.type!=='Point'||!Array.isArray(g.coordinates))return[];
    const [lon,lat]=g.coordinates;if(!Number.isFinite(lat)||Math.abs(lat)>90||!Number.isFinite(lon)||Math.abs(lon)>180)return[];
    const street=text(p.street,512),house=text(p.housenumber,100),name=text(p.name,512),line1=street?[house,street].filter(Boolean).join(' '):name;
    if(!line1||line1.length>512||!/^[-\d.]+$/.test(String(lat))||!/^[-\d.]+$/.test(String(lon)))return[];const city=text(p.city??p.town??p.village),region=text(p.state),postalCode=text(p.postcode,128),country=text(p.country);
    return[{label:[name&&name!==line1?name:null,line1,city,region,postalCode,country].filter(Boolean).join(', ').slice(0,1500),line1,city,region,postalCode,country,latitude:String(lat),longitude:String(lon)}];
   }).slice(0,5);
   const seen=new Set(),unique=suggestions.filter(row=>{const identity=JSON.stringify([row.line1,row.city,row.region,row.postalCode,row.country]).toLowerCase();if(seen.has(identity))return false;seen.add(identity);return true;});
   const value={suggestions:unique,provider:'Photon / OpenStreetMap',postalVerified:false};cache.set(key,{at:now,value});if(cache.size>20)cache.delete(cache.keys().next().value);return structuredClone(value);
  }catch{throw Error('ADDRESS_SEARCH_UNAVAILABLE');}finally{busy=false;}
 };
}
