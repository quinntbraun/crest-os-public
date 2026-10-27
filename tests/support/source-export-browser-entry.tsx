// Disposable browser fixture entry only. Never imported by a product route.
import {createRoot} from 'react-dom/client';
import {SourceExportScreen} from '../../src/app/export-files/export-files';
import {authentication} from '../../src/client/authentication';
import type {LoginInput} from '../../src/client/authentication';

declare global{interface Window{crestExportFixture:Readonly<{signIn:(input:LoginInput)=>Promise<void>;show:()=>void}>}}
const element=document.getElementById('fixture');if(!element)throw Error('EXPORT_BROWSER_FIXTURE_ROOT_REQUIRED');const root=createRoot(element);
Object.defineProperty(window,'crestExportFixture',{value:Object.freeze({async signIn(input:LoginInput){await authentication.login(input,new AbortController().signal);},show(){root.render(<SourceExportScreen/>);}}),writable:false,configurable:false});
