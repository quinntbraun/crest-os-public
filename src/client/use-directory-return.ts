'use client';
import {useCallback,useRef,useState} from 'react';
import {customerUuid} from '../customer/customer-contract';
import {directoryDestinations} from './directory-navigation';
import type {DirectoryDestination} from './directory-navigation';
import {readSignInReturn} from './sign-in-navigation';

// Only an opaque record pointer and finite navigation choices survive clearing.
export function useDirectoryReturn(destination:DirectoryDestination,initialId:string|null,initialIncludeAll=false){
 const [selection,setSelection]=useState(customerUuid(initialId)?initialId:null);
 const record=useRef(selection),includeAll=useRef(initialIncludeAll);
 const write=useCallback((id:string|null,include:boolean,section?:string,metadata:Readonly<Record<string,unknown>>={})=>{
  const config=directoryDestinations[destination];
  if(window.location.pathname!==config.path)return;
  const input:Record<string,unknown>=Object.create(null),params=new URLSearchParams(window.location.search);
  for(const key of new Set(params.keys())){
   const values=params.getAll(key);input[key]=values.length===1?values[0]:values;
  }
  if(input[config.parameter]!==id){delete input.focusVehicle;if(destination!=='leads')delete input.view;}
  Object.assign(input,metadata);
  input[config.parameter]=id;input.include=include?config.include:undefined;
  if(section!==undefined)input.view=section;
  const navigation=readSignInReturn({...input,returnTo:destination});
  if(navigation)window.history.replaceState(null,'',navigation.href+window.location.hash);
 },[destination]);
 const remember=useCallback((id:string|null,section?:string)=>{
  const next=customerUuid(id)?id:null;record.current=next;setSelection(next);write(next,includeAll.current,section);
 },[write]);
 const rememberFilter=useCallback((include:boolean)=>{
  includeAll.current=include;write(record.current,include);
 },[write]);
 const rememberNavigation=useCallback((metadata:Readonly<Record<string,unknown>>)=>write(record.current,includeAll.current,undefined,metadata),[write]);
 return {selection,includeAll,remember,rememberFilter,rememberNavigation};
}
