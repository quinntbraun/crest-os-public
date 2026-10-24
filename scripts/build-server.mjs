import {build} from 'rolldown';
import {isAbsolute} from 'node:path';
import {mkdir} from 'node:fs/promises';

await mkdir(new URL('../.local/server/',import.meta.url),{recursive:true});
await build({
  input:{main:'src/server/main.ts',application:'src/server/application.ts','image-worker':'src/files/image-worker.ts'},platform:'node',
  // Only the official server-only marker is resolved under react-server. All
  // runtime packages (including Next/React) retain normal Node resolution.
  external:id=>id!=='server-only'&&!id.startsWith('.')&&!isAbsolute(id),
  resolve:{conditionNames:['react-server','node','import','default']},
  output:{dir:'.local/server',format:'esm',entryFileNames:'[name].mjs',chunkFileNames:'[name]-[hash].mjs',minify:false,sourcemap:false},
  onwarn(warning){throw new Error(`SERVER_BUILD_FAILED:${warning.code}`);}
});
