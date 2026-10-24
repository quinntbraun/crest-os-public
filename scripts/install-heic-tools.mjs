import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile,copyFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
if(process.platform!=='linux'||process.arch!=='x64')throw new Error('HEIC_NATIVE_PLATFORM_UNSUPPORTED');
const {heic}=JSON.parse(await readFile(new URL('../release/toolchain.json',import.meta.url),'utf8'));
const root=fileURLToPath(new URL('../.local/tools/heic/',import.meta.url)),sourceRoot=fileURLToPath(new URL('../.local/tools/heic-build/',import.meta.url));
await mkdir(resolve(root,'sources'),{recursive:true});await mkdir(resolve(root,'share/licenses'),{recursive:true});
const run=(command,args,timeout=60000)=>execFileSync(command,args,{encoding:'utf8',timeout,maxBuffer:8*1024*1024});
let fixturePlan;
for(const library of ['libde265','libheif']){
  const version=heic[library],sha=heic[library+'SourceSha256'],name=`${library}-${version}`;
  const r=await fetch(`https://github.com/strukturag/${library}/releases/download/v${version}/${name}.tar.gz`,{signal:AbortSignal.timeout(60000)});
  if(!r.ok)throw new Error('HEIC_SOURCE_DOWNLOAD_FAILED');const bytes=Buffer.from(await r.arrayBuffer());
  if(bytes.length>8*1024*1024||createHash('sha256').update(bytes).digest('hex')!==sha)throw new Error('HEIC_SOURCE_CHECKSUM_FAILED');
  const archive=resolve(root,'sources',name+'.tar.gz'),source=resolve(sourceRoot,name),build=resolve(source,'build');
  await writeFile(archive,bytes);await mkdir(source,{recursive:true});
  const entries=run('tar',['--list','--gzip','--file',archive]).trim().split('\n');
  if(entries.some(p=>(p!==name&&!p.startsWith(name+'/'))||p.includes('\\')||p.split('/').includes('..')))throw new Error('HEIC_SOURCE_ARCHIVE_INVALID');
  run('tar',['--extract','--gzip','--file',archive,'--directory',source,'--strip-components=1','--no-same-owner']);
  const options=['-DCMAKE_BUILD_TYPE=Release','-DBUILD_SHARED_LIBS=ON',`-DCMAKE_INSTALL_PREFIX=${root}`,'-DCMAKE_INSTALL_LIBDIR=lib',
    '-DCMAKE_INSTALL_RPATH=$ORIGIN','-DCMAKE_BUILD_RPATH_USE_ORIGIN=ON'];
  if(library==='libde265')options.push('-DENABLE_SDL=OFF','-DENABLE_DECODER=OFF','-DENABLE_ENCODER=OFF');
  else{
    options.push(`-DCMAKE_PREFIX_PATH=${root}`,'-DENABLE_PLUGIN_LOADING=OFF','-DWITH_LIBDE265=ON','-DWITH_LIBDE265_PLUGIN=OFF',
      '-DWITH_EXAMPLES=OFF','-DWITH_GDK_PIXBUF=OFF','-DBUILD_TESTING=OFF','-DBUILD_DOCUMENTATION=OFF','-DENABLE_PARALLEL_TILE_DECODING=OFF');
    for(const codec of ['X265','X264','OpenH264_DECODER','AOM_DECODER','AOM_ENCODER','DAV1D','SvtEnc','RAV1E','JPEG_DECODER','JPEG_ENCODER',
      'OpenJPEG_DECODER','OpenJPEG_ENCODER','OPENJPH_ENCODER','FFMPEG_DECODER','KVAZAAR','UVG266','VVDEC','VVENC','UNCOMPRESSED_CODEC','LIBSHARPYUV','HEADER_COMPRESSION','WEBCODECS'])options.push(`-DWITH_${codec}=OFF`);
  }
  run('cmake',['-S',source,'-B',build,...options]);run('cmake',['--build',build,'--parallel','2'],600000);run('cmake',['--install',build]);
  await copyFile(resolve(source,'COPYING'),resolve(root,'share/licenses',library+'-COPYING'));
  if(library==='libheif'&&process.argv.includes('--fixtures')){
    fixturePlan={source,options};
  }
}
await mkdir(resolve(root,'bin'),{recursive:true});
// libpng is static; only the LGPL libraries and existing base-image C/C++/zlib
// runtime libraries are dynamically linked. Consumers can replace/relink them.
run('g++',['-std=c++17','-O2','-Wall','-Wextra','-Werror',`-I${resolve(root,'include')}`,`-L${resolve(root,'lib')}`,
  'src/files/native/heic-decode.cc','-o',resolve(root,'bin/crest-heic-decode'),'-Wl,-rpath,$ORIGIN/../lib','-lheif','-lde265','-Wl,-Bstatic','-lpng16','-Wl,-Bdynamic','-lz']);
async function retainPng(){for(const path of ['/usr/share/doc/libpng16-16/copyright','/usr/share/doc/libpng16-16t64/copyright']){try{await copyFile(path,resolve(root,'share/licenses/libpng-copyright'));return;}catch{/* Next documented distro path. */}}throw new Error('HEIC_NATIVE_NOTICE_MISSING');}
await retainPng();
for(const [name,path] of [['zlib-copyright','/usr/share/doc/zlib1g/copyright'],
 ['LGPL-3','/usr/share/common-licenses/LGPL-3'],['GPL-3','/usr/share/common-licenses/GPL-3']])await copyFile(path,resolve(root,'share/licenses',name));
await copyFile('src/files/native/heic-decode.cc',resolve(root,'sources/heic-decode.cc'));
await copyFile(fileURLToPath(import.meta.url),resolve(root,'sources/install-heic-tools.mjs'));
await copyFile('release/toolchain.json',resolve(root,'sources/toolchain.json'));
await writeFile(resolve(root,'share/licenses/LINKING-NOTICE'),'The libheif and libde265 libraries are governed by the retained LGPL notices. Recipients may replace these libraries and reverse engineer/debug this adapter as needed to exercise the library modification/relinking rights required by LGPLv3 section4. The corresponding library sources, adapter source and build/relink recipe are provided in ../../sources. No signing or encryption key is required. This limited linking permission does not grant an app-wide license to unrelated Crest OS code.\n');
await writeFile(resolve(root,'sources/REBUILD'),'Corresponding library source archives, native adapter, build script and pins are retained here.\nTo rebuild: install Node24, CMake, g++, make, pkg-config, libpng-dev and zlib1g-dev in an x64 Linux environment; create a scratch project with scripts/, release/ and src/files/native/. Copy install-heic-tools.mjs to scripts/, toolchain.json to release/ and heic-decode.cc to src/files/native/. Run node scripts/install-heic-tools.mjs from that project root. Archives are also available at the immutable SHA-256-pinned official release URLs in that script. Modify either LGPL library source, rebuild and replace the libraries under lib/ or rebuild/relink the supplied adapter. No signing/encryption key is required. The Crest repository retains the corresponding application source.\n');
await writeFile(resolve(root,'share/licenses/BUILD-RECEIPT'),`Pinned libheif/libde265 source archives and build adapter are in ../../sources.\nDynamic LGPL libraries are in ../../lib; replaceable without application code changes. No plugin loading or extra codecs.\n`+
  run('dpkg-query',['--show','--showformat=${binary:Package} ${Version}\\n','cmake','g++','libpng-dev','zlib1g-dev']));
const version=run(resolve(root,'bin/crest-heic-decode'),['--version']);
if(version.trim()!==`crest-heic-v1 libheif${heic.libheif} libde265${heic.libde265}`)throw new Error('HEIC_NATIVE_VERSION_FAILED');
console.log('HEIC inspector: verified source hashes, compiled HEVC-only decoder, retained LGPL sources/notices, executable versions');
if(fixturePlan){
  // Compile/check the actual adapter before spending time on test-only tools.
  // The GPL x265 encoder has a separate prefix, never copied into the release.
  const {source,options}=fixturePlan,fixtureRoot=fileURLToPath(new URL('../.local/tools/heic-fixtures/',import.meta.url)),fixtureBuild=resolve(source,'build-fixtures');
  run('cmake',['-S',source,'-B',fixtureBuild,...options,`-DCMAKE_INSTALL_PREFIX=${fixtureRoot}`,
    `-DCMAKE_INSTALL_RPATH=$ORIGIN/../lib;$ORIGIN;${resolve(root,'lib')}`,'-DWITH_X265=ON','-DWITH_EXAMPLES=ON',
    '-DWITH_EXAMPLE_HEIF_THUMB=OFF','-DWITH_EXAMPLE_HEIF_VIEW=OFF']);
  run('cmake',['--build',fixtureBuild,'--parallel','2'],600000);run('cmake',['--install',fixtureBuild]);
}
