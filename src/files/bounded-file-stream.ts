import 'server-only';

export function boundedFileStream(body:ReadableStream<Uint8Array>,size:number,signal:AbortSignal){
 const reader=body.getReader();
 let received=0;
 return new ReadableStream<Uint8Array>({
  async pull(controller){
   try{
    signal.throwIfAborted();
    const chunk=await reader.read();
    signal.throwIfAborted();
    if(chunk.done){
     if(received!==size)throw Error();
     reader.releaseLock();controller.close();return;
    }
    received+=chunk.value.byteLength;
    if(received>size)throw Error();
    controller.enqueue(chunk.value);
   }catch{
    await reader.cancel().catch(()=>undefined);reader.releaseLock();
    controller.error(Error('FILE_UPLOAD_UNCONFIRMED'));
   }
  },
  async cancel(){try{await reader.cancel();}finally{reader.releaseLock();}}
 });
}
