import {it,expect} from 'vitest';
import {EventEmitter} from 'node:events';
import {parseSyntheticPhoneBinding,restrictSyntheticPhoneSockets} from '../../scripts/synthetic-phone-binding.mjs';
const id='0123456789abcdef',input={formatVersion:1,workspaceId:id,laptopAddress:'100.64.1.1',phoneAddress:'100.64.1.2',certificateSha256:'a'.repeat(64)};
const status={daemonStatus:'Connected',management:{connected:true},netbirdIp:input.laptopAddress+'/16',peers:{total:1,details:[{netbirdIp:input.phoneAddress,status:'Idle'}]}};
it('binds only the matching synthetic workspace and two registered owned private peers',()=>{
 const parsed=parseSyntheticPhoneBinding(input,status,id);expect(parsed.origin).toBe('https://100.64.1.1:4319');expect(Object.isFrozen(parsed)).toBe(true);expect(input).not.toHaveProperty('origin');
});
it.each([{laptopAddress:'0.0.0.0'},{laptopAddress:'127.0.0.1'},{laptopAddress:'100.128.0.1'},{laptopAddress:'100.64.1.1/16'},{phoneAddress:'100.64.1.1'},{phoneAddress:'db.example.com'},{workspaceId:'1111111111111111'},{certificateSha256:'invalid'},{port:3000}])('rejects broadened or mismatched private listener configuration:%j',patch=>{
 expect(()=>parseSyntheticPhoneBinding({...input,...patch},status,id)).toThrow(/^SYNTHETIC_PHONE_PREVIEW_REVIEW_REQUIRED$/);
});
it.each([{daemonStatus:'Disconnected'},{management:{connected:false}},{netbirdIp:'100.64.1.9/16'},{peers:{total:2,details:status.peers.details}},{peers:{total:1,details:[{netbirdIp:'100.64.1.9'}]}}])('rejects disconnected or changed device authority:%j',patch=>{
 expect(()=>parseSyntheticPhoneBinding(input,{...status,...patch},id)).toThrow(/^SYNTHETIC_PHONE_PREVIEW_REVIEW_REQUIRED$/);
});
it('checks the raw socket peer before later connection listeners and ignores forwarded identity',()=>{
 const server=new EventEmitter(),binding=parseSyntheticPhoneBinding(input,status,id),observed:boolean[]=[];server.on('connection',socket=>observed.push(socket.destroyed));restrictSyntheticPhoneSockets(server,binding);
 for(const [remoteAddress,denied]of [['100.64.1.1',false],['100.64.1.2',false],['::ffff:100.64.1.2',false],['100.64.1.3',true],['127.0.0.1',true],[undefined,true]] as const){const socket={remoteAddress,destroyed:false,headers:{'x-forwarded-for':input.phoneAddress},destroy(){this.destroyed=true;}};server.emit('connection',socket);expect(socket.destroyed).toBe(denied);}
 expect(observed).toEqual([false,false,false,true,true,true]);
});
