export function appointmentDateTime(instant:string,timezone:string){
 try{
  return new Intl.DateTimeFormat('en-US',{timeZone:timezone,month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'}).format(new Date(instant));
 }catch{return instant+' UTC';}
}

export function AppointmentTime({start,end,timezone,showOffset=false}:{start:string;end:string;timezone:string;showOffset?:boolean}){
 const day=new Intl.DateTimeFormat('en-CA',{timeZone:timezone,dateStyle:'short'});
 const startDate=new Date(start),endDate=new Date(end);
 const offset=new Intl.DateTimeFormat('en-US',{timeZone:timezone,timeZoneName:'shortOffset',hour:'numeric'});
 const zoneOf=(value:Date)=>offset.formatToParts(value).find(part=>part.type==='timeZoneName')?.value;
 const startOffset=zoneOf(startDate),endOffset=zoneOf(endDate),offsetChange=startOffset!==endOffset;
 const endLabel=day.format(startDate)===day.format(endDate)
  ?new Intl.DateTimeFormat('en-US',{timeZone:timezone,hour:'numeric',minute:'2-digit'}).format(endDate)
  :appointmentDateTime(end,timezone);
 return <>
  <time dateTime={start}>{appointmentDateTime(start,timezone)}{offsetChange&&' '+startOffset}</time>
  {' – '}<time dateTime={end}>{endLabel}{offsetChange&&' '+endOffset}</time>
  <span className="job-appointment-zone">{timezone}{showOffset&&!offsetChange&&startOffset?' · '+startOffset:''}</span>
 </>;
}
