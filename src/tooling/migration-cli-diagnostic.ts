// Keep raw CLI output/SQL/connection details out of errors and receipts. Only
// identifiers already present in this public migration snapshot can survive.
export function migrationCliDiagnostic(files:ReadonlyMap<string,Uint8Array>,stdout:string,stderr:string){
 const output=(stdout+'\n'+stderr).slice(0,256000),known=new Set<string>();
 for(const bytes of files.values())for(const match of new TextDecoder().decode(bytes).matchAll(/\bCREST_[A-Z0-9_]{1,100}\b/g))known.add(match[0]);
 return Object.freeze({formatVersion:1,outcome:'failed_review_required' as const,
  publicMigrationFiles:Object.freeze([...files.keys()].filter(file=>output.includes(file))),
  publicErrorCodes:Object.freeze([...known].filter(code=>new RegExp('\\b'+code+'\\b').test(output)).sort()),
  rawOutputRetained:false as const});
}
