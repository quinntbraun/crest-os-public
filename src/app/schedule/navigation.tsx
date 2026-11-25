'use client';

import {createContext,useContext} from 'react';
import type {ComponentProps,ReactNode} from 'react';
import {scheduleNavigationHref} from '../../client/schedule-navigation';
import type {ScheduleNavigation} from '../../client/schedule-navigation';

const NavigationContext=createContext<ScheduleNavigation|null>(null);
export const useScheduleNavigation=()=>useContext(NavigationContext);
export function ScheduleNavigationProvider({context,children}:{context:ScheduleNavigation|null;children:ReactNode}){
 return <NavigationContext.Provider value={context}>{children}</NavigationContext.Provider>;
}
export function ScheduleLink({href,...props}:ComponentProps<'a'>&{href:string}){
 const context=useScheduleNavigation();
 return <a {...props} href={scheduleNavigationHref(href,context)}/>;
}
