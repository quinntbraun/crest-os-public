import assert from 'node:assert/strict';
import {readFile,mkdir,readdir,writeFile} from 'node:fs/promises';
import {spawn,execFileSync} from 'node:child_process';
import {browserGroups,browserGroupFiles} from '../src/tooling/browser-groups.ts';

const pkg=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8')),command=pkg.scripts['test:sign-in-browser'];
const plan=Object.keys(browserGroups).map(name=>({name,files:browserGroupFiles(command,name)}));
if(process.argv.length===3&&process.argv[2]==='--list'){
 console.log(JSON.stringify({groups:plan,totalFiles:plan.reduce((n,g)=>n+g.files.length,0)},null,2));
}else{
 assert.equal(process.argv.length,3);if(process.env.CI==='true')assert.equal(Number(process.env.CREST_BROWSER_JOB_TOTAL),plan.length,'Every browser matrix entry is required');
 const selected=process.argv[2],files=browserGroupFiles(command,selected),args=['--test','--test-concurrency=1',...files];
 console.log('REQUIRED_BROWSER_GROUP '+JSON.stringify({group:selected,files}));
 const child=spawn(process.execPath,args,{stdio:'inherit',windowsHide:true});
 const result=await new Promise(resolve=>{child.once('error',()=>resolve({code:1,signal:null}));child.once('close',(code,signal)=>resolve({code,signal}));});
 let screenshots=[];try{screenshots=(await readdir('.local/review')).filter(name=>/^(settings|workspace|home|quote|amendment|appointment)-.*\.png$/.test(name)).sort();}catch(error){if(error.code!=='ENOENT')throw error;}
 const needsScreenshots=['commercial','amendments','schedule','records'].includes(selected),passed=result.code===0&&result.signal===null&&(!needsScreenshots||screenshots.length>0);
 await mkdir('.local/ci-browser',{recursive:true});await writeFile('.local/ci-browser/'+selected+'.json',JSON.stringify({schemaVersion:1,sourceCommit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),group:selected,files,args,childExitCode:result.code,childSignal:result.signal,screenshots,screenshotsRequired:needsScreenshots,passed},null,2)+'\n',{flag:'wx'});
 if(!passed){console.error('REQUIRED_BROWSER_GROUP_FAILED');process.exitCode=typeof result.code==='number'&&result.code!==0?result.code:1;}
}
