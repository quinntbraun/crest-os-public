// These adopted migrations retain schema109's posting and export vocabulary.
// Schema122 adds only a scoped reader. Unknown future schemas stay distinct.
const compatibleSchemas=[110,111,112,113,114,115,116,117,118,119,120,121,122];
export function financePostingSchema(sourceSchema:number|undefined){
 return sourceSchema!==undefined&&compatibleSchemas.includes(sourceSchema)?109:sourceSchema;
}
