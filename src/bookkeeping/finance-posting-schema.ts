// These adopted migrations retain schema109's posting and export vocabulary.
// 123/124 add dated read evidence; 125-131 add Calendar control/source metadata;
// 132 grants readonly migration metadata; 133 adds readonly business exports;
// 134 versions export jobs;135 adds retained provider-source export. Neither changes financial posting semantics.
// 136 freezes original membership;137 fixes mixed-kind original reader types.
// 138 adds an isolated read-only backup role; financial vocabulary stays109.
//139 retains nonposting opening-deposit evidence only.
//140 versions its scoped workspace export; it changes no posting vocabulary.
// No stored financial vocabulary changes. Unknown future schemas stay distinct.
const compatibleSchemas=[110,111,112,113,114,115,116,117,118,119,120,121,122,123,124,125,126,127,128,129,130,131,132,133,134,135,136,137,138,139,140];
export function financePostingSchema(sourceSchema:number|undefined){
 return sourceSchema!==undefined&&compatibleSchemas.includes(sourceSchema)?109:sourceSchema;
}
