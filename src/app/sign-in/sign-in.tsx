'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import type {FormEvent} from 'react';
import {authentication,AuthenticationError} from '../../client/authentication';
import type {Proof,LoginInput} from '../../client/authentication';

type View={phase:'checking'|'form'|'signed'|'unavailable'|'uncertain';message:string;busy:boolean};
export function SignIn(){
  const [view,setView]=useState<View>({phase:'checking',message:'Checking this device’s session…',busy:true});
  const current=useRef<Proof|null>(null),operation=useRef<{id:number;controller:AbortController}|null>(null),sequence=useRef(0),mounted=useRef(false);
  const recheckOnFocus=useRef(false);
  const status=useRef<HTMLParagraphElement>(null);
  const run=useCallback(async(kind:'session'|'login'|'logout',input?:LoginInput)=>{
    if(!mounted.current||operation.current)return;
    const id=++sequence.current,controller=new AbortController(),previous=current.current;operation.current={id,controller};current.current=null;
    setView({phase:'checking',message:kind==='login'?'Signing in…':kind==='logout'?'Signing out…':'Checking this device’s session…',busy:true});
    let next:View;
    try{
      if(kind==='logout'){
        if(!previous)throw new AuthenticationError('uncertain');
        const result=await authentication.logout(previous,controller.signal);
        next={phase:'form',message:result.providerSignedOut?'Signed out on this device.':'Signed out on this device. Background session cleanup is still pending.',busy:false};
      }else{
        const proof=kind==='login'&&input?await authentication.login(input,controller.signal):await authentication.session(controller.signal);
        if(mounted.current&&sequence.current===id)current.current=proof;
        next={phase:'signed',message:'Signed in on this device.',busy:false};
      }
    }catch(error){
      const reason=error instanceof AuthenticationError?error.kind:'uncertain';
      next=reason==='unavailable'?{phase:'unavailable',message:'Sign-in is not available while setup is in progress. Check again later.',busy:false}
        :reason==='denied'&&kind!=='logout'?{phase:'form',message:kind==='login'?'Sign-in failed. Check your email, password and current authenticator code.':'Sign in to continue.',busy:false}
        :{phase:'uncertain',message:kind==='logout'?'Sign-out could not be confirmed. Check this device’s session before trying again.':'The session could not be confirmed. Check this device’s session before trying again.',busy:false};
    }
    if(mounted.current&&sequence.current===id){operation.current=null;recheckOnFocus.current=next.phase==='signed'||next.phase==='uncertain';setView(next);if(kind!=='session')requestAnimationFrame(()=>{if(mounted.current&&sequence.current===id)status.current?.focus();});}
  },[]);
  useEffect(()=>{
    mounted.current=true;void run('session');
    // Returning from a password manager must not discard a partly filled form.
    const check=()=>{if(recheckOnFocus.current&&document.visibilityState==='visible')void run('session');};
    window.addEventListener('focus',check);window.addEventListener('pageshow',check);document.addEventListener('visibilitychange',check);
    return ()=>{mounted.current=false;operation.current?.controller.abort();operation.current=null;current.current=null;recheckOnFocus.current=false;
      window.removeEventListener('focus',check);window.removeEventListener('pageshow',check);document.removeEventListener('visibilitychange',check);};
  },[run]);
  function submit(event:FormEvent<HTMLFormElement>){
    event.preventDefault();if(operation.current)return;
    const form=event.currentTarget,data=new FormData(form);
    const input={email:String(data.get('email')??''),password:String(data.get('password')??''),code:String(data.get('code')??''),trusted:data.get('trusted')==='on'};
    // Clear sensitive DOM values immediately; a failed request is never replayed.
    for(const name of ['password','code']){const field=form.elements.namedItem(name);if(field instanceof HTMLInputElement)field.value='';}
    void run('login',input);
  }
  return <section aria-label="Device sign-in" aria-busy={view.busy}>
    <p ref={status} tabIndex={-1} role="status" aria-live="polite" aria-atomic="true">{view.message}</p>
    {view.phase==='form'&&<form onSubmit={submit}>
      <label htmlFor="email">Email</label><input id="email" name="email" type="email" autoComplete="username" autoCapitalize="none" spellCheck={false} maxLength={320} required/>
      <label htmlFor="password">Password</label><input id="password" name="password" type="password" autoComplete="current-password" maxLength={1024} required/>
      <label htmlFor="code">Authenticator code</label><input id="code" name="code" type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" minLength={6} maxLength={6} required aria-describedby="code-help"/>
      <p id="code-help" className="field-help">Enter the six-digit code from your authenticator app.</p>
      <label className="trust"><input name="trusted" type="checkbox"/><span>Trust this personal device</span></label>
      <p className="field-help">Optional. Stay signed in for up to 30 days, with a seven-day inactivity limit. Leave unchecked on a shared device.</p>
      <button type="submit">Sign in</button>
    </form>}
    {view.phase==='signed'&&<><h2>Session verified</h2><p>Your device is signed in. Workspace tools check your business access before loading records.</p><a className="primary-action" href="/">Open workspace</a><a href="/customers">Customers</a><a href="/leads">Leads</a><a href="/settings">Business settings</a><button type="button" className="secondary" onClick={()=>void run('logout')}>Sign out on this device</button></>}
    {!view.busy&&<button className="secondary" type="button" onClick={()=>void run('session')}>Check session</button>}
    <p className="field-help">Session checks do not extend your sign-in. Account setup and recovery are not available here yet.</p>
  </section>;
}
