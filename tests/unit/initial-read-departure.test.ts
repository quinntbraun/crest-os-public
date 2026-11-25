import {expect,it,vi} from 'vitest';
import {observeInitialReadDeparture} from '../../src/client/initial-read-departure';

it('permits the live document initial read',()=>{
 const target=new EventTarget(),boundary=observeInitialReadDeparture(target),read=vi.fn();
 if(boundary.canStart())read();expect(read).toHaveBeenCalledOnce();boundary.dispose();
});
it('remembers departure before a deferred initial reader is ready',()=>{
 const target=new EventTarget(),boundary=observeInitialReadDeparture(target),read=vi.fn();
 target.dispatchEvent(new Event('beforeunload'));
 if(boundary.canStart())read();expect(read).not.toHaveBeenCalled();boundary.dispose();
});
it('does not prevent navigation, prompt, or suppress another listener',()=>{
 const target=new EventTarget(),boundary=observeInitialReadDeparture(target),other=vi.fn();
 target.addEventListener('beforeunload',other);const event=new Event('beforeunload',{cancelable:true});
 expect(target.dispatchEvent(event)).toBe(true);expect(event.defaultPrevented).toBe(false);
 expect(other).toHaveBeenCalledOnce();expect(boundary.canStart()).toBe(false);boundary.dispose();
});
it('does not reopen automatic reading on a late ordinary pageshow',()=>{
 const target=new EventTarget(),boundary=observeInitialReadDeparture(target);
 target.dispatchEvent(new Event('beforeunload'));target.dispatchEvent(Object.assign(new Event('pageshow'),{persisted:false}));
 expect(boundary.canStart()).toBe(false);boundary.dispose();
});
it('allows a persisted restored document to initialize again',()=>{
 const target=new EventTarget(),boundary=observeInitialReadDeparture(target);
 target.dispatchEvent(new Event('beforeunload'));target.dispatchEvent(Object.assign(new Event('pageshow'),{persisted:true}));
 expect(boundary.canStart()).toBe(true);boundary.dispose();
});
it('keeps a canceled departure paused without blocking another live document',()=>{
 const target=new EventTarget(),boundary=observeInitialReadDeparture(target);
 target.addEventListener('beforeunload',event=>event.preventDefault());
 expect(target.dispatchEvent(new Event('beforeunload',{cancelable:true}))).toBe(false);
 const fresh=observeInitialReadDeparture(new EventTarget());
 expect(boundary.canStart()).toBe(false);expect(fresh.canStart()).toBe(true);fresh.dispose();boundary.dispose();
});
it('releases its own listeners without removing another boundary',()=>{
 const target=new EventTarget(),first=observeInitialReadDeparture(target),second=observeInitialReadDeparture(target),remove=vi.spyOn(target,'removeEventListener');
 first.dispose();first.dispose();expect(remove).toHaveBeenCalledTimes(2);
 target.dispatchEvent(new Event('beforeunload'));expect(second.canStart()).toBe(false);expect(first.canStart()).toBe(false);second.dispose();
});
