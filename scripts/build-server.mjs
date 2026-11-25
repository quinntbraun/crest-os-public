import {build} from 'rolldown';
import {isAbsolute} from 'node:path';
import {mkdir,writeFile} from 'node:fs/promises';
import {serverBuildIdentity} from './server-build-identity.mjs';

await mkdir(new URL('../.local/server/',import.meta.url),{recursive:true});
const identity=await serverBuildIdentity();
await build({
  transform:{define:{__CREST_SERVER_BUILD_IDENTITY__:JSON.stringify(JSON.stringify(identity))}},
  input:{main:'src/server/main.ts','receipt-worker':'src/server/receipt-worker-main.ts','photo-worker':'src/server/photo-worker-main.ts','supplier-worker':'src/server/supplier-worker-main.ts','opening-document-worker':'src/server/opening-document-worker-main.ts','calendar-worker':'src/server/calendar-worker-main.ts',health:'src/server/health-main.ts',application:'src/server/application.ts','image-worker':'src/files/image-worker.ts','pdf-worker':'src/files/pdf-worker.ts','heic-worker':'src/files/heic-worker.ts','synthetic-supplier-document-worker':'src/server/synthetic-supplier-document-worker.ts','synthetic-expense-receipt-worker':'src/server/synthetic-expense-receipt-worker.ts'},platform:'node',
  // Only the official server-only marker is resolved under react-server. All
  // runtime packages (including Next/React) retain normal Node resolution.
  external:id=>id!=='server-only'&&!id.startsWith('.')&&!isAbsolute(id),
  resolve:{conditionNames:['react-server','node','import','default']},
  output:{dir:'.local/server',format:'esm',entryFileNames:'[name].mjs',chunkFileNames:'[name]-[hash].mjs',minify:false,sourcemap:false},
  onwarn(warning){throw new Error(`SERVER_BUILD_FAILED:${warning.code}`);}
});
if(JSON.stringify(await serverBuildIdentity())!==JSON.stringify(identity))throw Error('SERVER_BUILD_SOURCE_CHANGED');
const compiled=await import(new URL('../.local/server/application.mjs',import.meta.url));
if(JSON.stringify(compiled.getServerBuildIdentity())!==JSON.stringify(identity))throw Error('SERVER_BUILD_IDENTITY_MISMATCH');
await writeFile(new URL('../.local/server/build-identity.json',import.meta.url),JSON.stringify(identity,null,2)+'\n');
