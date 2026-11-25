export const directoryDestinations={
 customers:{path:'/customers',parameter:'customer',include:'archived'},
 vehicles:{path:'/vehicles',parameter:'vehicle',include:'archived'},
 leads:{path:'/leads',parameter:'lead',include:'lost'},
 services:{path:'/services',parameter:'service',include:'inactive'},
} as const;
export type DirectoryDestination=keyof typeof directoryDestinations;
export function readDirectoryInclude(destination:DirectoryDestination,input:Readonly<Record<string,unknown>>){
 return input.include===directoryDestinations[destination].include;
}
export function readLeadNavigation(input:Readonly<Record<string,unknown>>){
 return {directory:input.view==='directory',reminders:input.reminders==='due'||input.reminders==='upcoming'?input.reminders:'all'} as const;
}
