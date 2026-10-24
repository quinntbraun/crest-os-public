// Synthetic PDFs only. Offsets are byte-based; fixtures never contain Crest data.
import {mkdtemp,writeFile,readFile,unlink,rmdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const execute=promisify(execFile);
export const qpdf=resolve('.local/tools/pdf/qpdf/bin',process.platform==='win32'?'qpdf.exe':'qpdf');
export function stream(data,extra=''){
  const b=Buffer.from(data);return Buffer.concat([Buffer.from(`<< /Length ${b.length} ${extra} >>\nstream\n`),b,Buffer.from('\nendstream')]);
}
export function pdf({pages=1,catalog='',page='',extras=[],padding=0,content,width=200,height=100}={}){
  const objects=[`<< /Type /Catalog /Pages 2 0 R ${catalog} >>`,
    `<< /Type /Pages /Count ${pages} /Kids [${Array.from({length:pages},(_,i)=>`${3+i*2} 0 R`).join(' ')}] >>`];
  for(let i=0;i<pages;i++)objects.push(`<< /Type /Page /Parent 2 0 R /Resources << >> /MediaBox [0 0 ${width} ${height}] /Contents ${4+i*2} 0 R ${page} >>`,
    stream(content??(i%2?'0 0.8 0 rg 0 0 200 100 re f':'0 0 0.8 rg 0 0 200 100 re f')));
  objects.push(...extras);
  if(padding)objects.push(stream(Buffer.alloc(padding,32)));
  return objectsPdf(objects);
}
export function objectsPdf(objects){
  const parts=[Buffer.from('%PDF-1.7\n%\xE2\xE3\xCF\xD3\n','latin1')],offsets=[0];let length=parts[0].length;
  for(let i=0;i<objects.length;i++){
    offsets.push(length);const part=Buffer.concat([Buffer.from(`${i+1} 0 obj\n`),Buffer.from(objects[i]),Buffer.from('\nendobj\n')]);parts.push(part);length+=part.length;
  }
  parts.push(Buffer.from(`xref\n0 ${objects.length+1}\n0000000000 65535 f \n${offsets.slice(1).map(n=>`${String(n).padStart(10,'0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${length}\n%%EOF\n`));
  return Buffer.concat(parts);
}
export async function transform(bytes,args){
  const directory=await mkdtemp(join(tmpdir(),'crest-pdf-fixture-')),input=join(directory,'in.pdf'),output=join(directory,'out.pdf');
  try{await writeFile(input,bytes);await execute(qpdf,[...args,input,output],{timeout:15000,maxBuffer:65536,windowsHide:true});return await readFile(output);}
  finally{await unlink(input).catch(()=>{});await unlink(output).catch(()=>{});await rmdir(directory);}
}
export async function pdfFixtures(){
  const simple=pdf(),javascript=pdf({catalog:'/Names << /JavaScript << /Names [(x) 5 0 R] >> >>',extras:['<< /S /Java#53cript /J#53 (throw new Error(secret)) >>']}),
    form=objectsPdf(['<< /Type /Catalog /Pages 2 0 R /AcroForm << /Fields [5 0 R] /NeedAppearances false >> >>',
      '<< /Type /Pages /Count 1 /Kids [3 0 R] >>',
      '<< /Type /Page /Parent 2 0 R /Resources << >> /MediaBox [0 0 200 100] /Contents 4 0 R /Annots [5 0 R] >>',stream(''),
      '<< /Type /Annot /Subtype /Widget /FT /Tx /T (synthetic receipt) /V (PAID) /Rect [10 10 190 90] /P 3 0 R /AP << /N 6 0 R >> >>',
      stream('0 g BT /F1 32 Tf 15 30 Td (PAID) Tj ET','/Type /XObject /Subtype /Form /BBox [0 0 180 80] /Resources << /Font << /F1 7 0 R >> >>'),
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>']);
  const invalid=[
    {name:'encrypted password',bytes:await transform(simple,['--encrypt','synthetic-user','synthetic-owner','256','--']),code:'PDF_ENCRYPTED'},
    {name:'encrypted empty user password',bytes:await transform(simple,['--encrypt','','synthetic-owner','256','--']),code:'PDF_ENCRYPTED'},
    {name:'escaped JavaScript names',bytes:javascript,code:'PDF_ACTIVE_CONTENT'},
    {name:'compressed JavaScript objects',bytes:await transform(javascript,['--object-streams=generate']),code:'PDF_ACTIVE_CONTENT'},
    {name:'unreferenced JavaScript',bytes:pdf({extras:['<< /S /JavaScript /JS (private marker) >>']}),code:'PDF_ACTIVE_CONTENT'},
    {name:'compressed unreferenced JavaScript',bytes:await transform(pdf({extras:['<< /S /JavaScript /JS (private marker) >>']}),['--object-streams=generate','--preserve-unreferenced']),code:'PDF_ACTIVE_CONTENT'},
    ...['/OpenAction << /S /Launch /F (local-file) >>','/AA << /WC << /S /JavaScript /JS (x) >> >>',
      '/Names << /EmbeddedFiles << /Names [(x) 5 0 R] >> >>', '/AF [5 0 R]', '/AcroForm << /XFA (x) >>',
      '/RichMedia << >>','/Action << /S /SubmitForm /F (https://example.invalid) >>'].map(catalog=>({name:catalog.split(' ')[0],
      bytes:pdf({catalog,extras:['<< /Type /Filespec /F (x) >>']}),code:'PDF_ACTIVE_CONTENT'})),
    {name:'embedded file stream',bytes:pdf({extras:[stream('x','/Type /EmbeddedFile')]}),code:'PDF_ACTIVE_CONTENT'},
    {name:'external stream',bytes:objectsPdf(['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Count 1 /Kids [3 0 R] >>',
      '<< /Type /Page /Parent 2 0 R /Resources << >> /MediaBox [0 0 200 100] /Contents 4 0 R >>',stream('','/F (external-file)')]),code:'PDF_UNINSPECTABLE'},
    {name:'broken later page compressed stream',bytes:objectsPdf(['<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Count 2 /Kids [3 0 R 5 0 R] >>',
      '<< /Type /Page /Parent 2 0 R /Resources << >> /MediaBox [0 0 200 100] /Contents 4 0 R >>',stream(''),
      '<< /Type /Page /Parent 2 0 R /Resources << >> /MediaBox [0 0 200 100] /Contents 6 0 R >>',stream('not deflate','/Filter /FlateDecode')]),code:'PDF_UNINSPECTABLE'},
    {name:'101 pages',bytes:pdf({pages:101}),code:'PDF_PAGE_LIMIT'},
    {name:'trailing payload',bytes:Buffer.concat([simple,Buffer.from('hidden')]),code:'PDF_CONTAINER_INVALID'},
    {name:'truncated EOF',bytes:simple.subarray(0,-8),code:'PDF_CONTAINER_INVALID'},
    {name:'incorrect header',bytes:Buffer.concat([Buffer.from('NOTPDF!!'),simple.subarray(8)]),code:'PDF_CONTAINER_INVALID'},
    {name:'bad cross reference',bytes:Buffer.from(simple.toString('latin1').replace(/startxref\n\d+/, 'startxref\n1'),'latin1'),code:'PDF_UNINSPECTABLE'},
    {name:'empty file',bytes:Buffer.alloc(0),code:'PDF_SIZE_INVALID'}
  ];
  return {simple,form,javascript,invalid,valid:[{name:'static page',bytes:simple},{name:'compressed object streams',bytes:await transform(simple,['--object-streams=generate'])},
    {name:'literal text is not executable',bytes:pdf({extras:['<< /Subject (/JavaScript /JS harmless literal) >>']})},{name:'filled AcroForm appearance',bytes:form}]};
}
