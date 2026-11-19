import {expect,it} from 'vitest';
import {startFinanceActivity,watchFinanceActivity} from '../../src/client/finance-activity';
it('keeps snapshots invalidated until overlapping work settles, including repeated cleanup',()=>{
 const values:number[]=[];const stop=watchFinanceActivity(count=>values.push(count));
 const a=startFinanceActivity(),b=startFinanceActivity();a();a();expect(values).toEqual([0,1,2,1]);b();expect(values).toEqual([0,1,2,1,0]);stop();
 const c=startFinanceActivity();c();expect(values).toEqual([0,1,2,1,0]);
});
it('never lets a presentation observer change the outcome of an existing financial request',()=>{
 let broken=false;const stop=watchFinanceActivity(()=>{if(broken)throw Error('presentation failed');});broken=true;
 let finish:()=>void=()=>{};expect(()=>{finish=startFinanceActivity();}).not.toThrow();expect(()=>finish()).not.toThrow();stop();
 const values:number[]=[];const remove=watchFinanceActivity(count=>values.push(count));expect(values).toEqual([0]);remove();
});
