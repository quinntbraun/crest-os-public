import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile,chmod,copyFile} from 'node:fs/promises';
import {resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {unzipSync} from 'fflate';
const {pdf}=JSON.parse(await readFile(new URL('../release/toolchain.json',import.meta.url),'utf8'));
if(process.arch!=='x64'||!['linux','win32'].includes(process.platform))throw new Error('PDF_TOOL_PLATFORM_UNSUPPORTED');
const windows=process.platform==='win32',name=windows?`qpdf-${pdf.qpdfVersion}-mingw64.zip`:`qpdf-${pdf.qpdfVersion}.tar.gz`;
const url=`https://github.com/qpdf/qpdf/releases/download/v${pdf.qpdfVersion}/${name}`;
const response=await fetch(url,{signal:AbortSignal.timeout(60000)});
if(!response.ok)throw new Error('PDF_TOOL_DOWNLOAD_FAILED');
const archive=Buffer.from(await response.arrayBuffer());
if(archive.length>32*1024*1024||createHash('sha256').update(archive).digest('hex')!==(windows?pdf.windowsX64Sha256:pdf.qpdfSourceSha256))throw new Error('PDF_TOOL_CHECKSUM_FAILED');
const root=fileURLToPath(new URL('../.local/tools/pdf/qpdf/',import.meta.url)),exe=windows?'qpdf.exe':'qpdf';
await mkdir(root,{recursive:true});
if(windows){
const files=unzipSync(archive);
const matches=Object.keys(files).filter(path=>path.endsWith(`/bin/${exe}`));
if(matches.length!==1)throw new Error('PDF_TOOL_ARCHIVE_INVALID');
const prefix=matches[0].slice(0,-`bin/${exe}`.length);
let total=0;
for(const [path,bytes] of Object.entries(files)){
  if(!path.startsWith(prefix)||path.endsWith('/'))continue;
  const relative=path.slice(prefix.length);const destination=resolve(root,relative);
  if(relative.includes('\\')||relative.split('/').includes('..')||!destination.startsWith(resolve(root)+sep))throw new Error('PDF_TOOL_ARCHIVE_INVALID');
  total+=bytes.length;if(total>128*1024*1024)throw new Error('PDF_TOOL_ARCHIVE_INVALID');
  await mkdir(resolve(destination,'..'),{recursive:true});await writeFile(destination,bytes);
  if(relative.startsWith('bin/'))await chmod(destination,0o755);
}
}else{
  const source=fileURLToPath(new URL(`../.local/tools/pdf/source-${pdf.qpdfVersion}/`,import.meta.url)),tarball=resolve(source,'source.tar.gz'),build=resolve(source,'build');
  await mkdir(source,{recursive:true});await writeFile(tarball,archive);
  const run=(command,args,timeout=60000)=>execFileSync(command,args,{timeout,maxBuffer:8*1024*1024,encoding:'utf8'});
  const entries=run('tar',['--list','--gzip','--file',tarball]).trim().split('\n');
  if(entries.some(p=>!p.startsWith(`qpdf-${pdf.qpdfVersion}/`)||p.includes('\\')||p.split('/').includes('..')))throw new Error('PDF_TOOL_ARCHIVE_INVALID');
  run('tar',['--extract','--gzip','--file',tarball,'--directory',source,'--strip-components=1','--no-same-owner']);
  // Build against this environment's libc; only qpdf/libjpeg are linked
  // statically. zlib and standard C/C++ runtimes remain base-image libraries.
  run('cmake',['-S',source,'-B',build,'-DCMAKE_BUILD_TYPE=Release','-DBUILD_SHARED_LIBS=OFF','-DBUILD_STATIC_LIBS=ON',
    '-DUSE_IMPLICIT_CRYPTO=OFF','-DREQUIRE_CRYPTO_NATIVE=ON','-DSTATIC_JPEG=ON','-DBUILD_DOC=OFF']);
  run('cmake',['--build',build,'--target','qpdf','--parallel','2'],600000);
  await mkdir(resolve(root,'bin'),{recursive:true});await copyFile(resolve(build,'qpdf/qpdf'),resolve(root,'bin/qpdf'));await chmod(resolve(root,'bin/qpdf'),0o755);
  const notices=resolve(root,'share/licenses');await mkdir(notices,{recursive:true});
  for(const file of ['LICENSE.txt','NOTICE.md'])await copyFile(resolve(source,file),resolve(notices,file));
  async function retain(name,paths){for(const path of paths){try{await copyFile(path,resolve(notices,name));return;}catch{/* Try the next documented platform path. */}}throw new Error('PDF_TOOL_NOTICE_MISSING');}
  await retain('zlib-copyright',['/usr/share/doc/zlib1g/copyright']);
  await retain('libjpeg-copyright',['/usr/share/doc/libjpeg62-turbo/copyright','/usr/share/doc/libjpeg-turbo8/copyright']);
  await writeFile(resolve(notices,'BUILD-RECEIPT'),`qpdf source SHA-256: ${pdf.qpdfSourceSha256}\nNative crypto; static qpdf/libjpeg; system zlib/C/C++ runtime.\n`+
    run('dpkg-query',['--show','--showformat=${binary:Package} ${Version}\\n','cmake','g++','libjpeg-dev','zlib1g-dev']));
}
const binary=resolve(root,'bin',exe);
const version=execFileSync(binary,['--version'],{encoding:'utf8',timeout:15000,maxBuffer:65536,windowsHide:true});
if(!version.startsWith(`qpdf version ${pdf.qpdfVersion}\n`)&&!version.startsWith(`qpdf version ${pdf.qpdfVersion}\r\n`))throw new Error('PDF_TOOL_VERSION_FAILED');
console.log(`qpdf ${pdf.qpdfVersion}: verified SHA-256, retained distribution notices, executable version (${windows?'official Windows distribution':'Linux source build'})`);
