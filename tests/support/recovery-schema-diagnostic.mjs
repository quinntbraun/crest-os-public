import {createHash} from 'node:crypto';

const digest=value=>createHash('sha256').update(value).digest('hex');
const snapshots=new Map(),maximumSnapshots=128,maximumDifferences=12;
const schemas=new Set(['crest','crest_private','auth','public','extensions','supabase_migrations','-']);

function summarize(sql){
 const entries=new Map();
 for(const block of sql.split(/(?=^-- Name: )/m)){
  if(!block)continue;
  const header=block.match(/^-- Name: (.+); Type: ([A-Z ]+); Schema: ([a-z_]+|-); Owner: (.+)\r?$/m);
  // Even object names stay out of public logs: only their identity digest is kept.
  const key=header?digest(header[1]+'\0'+header[2]+'\0'+header[3]):digest('preamble');
  const entry=entries.get(key)??{kind:header&&/^[A-Z ]{1,32}$/.test(header[2])?header[2]:'other',
   schema:header&&schemas.has(header[3])?header[3]:'other',parts:[]};
  entry.parts.push(digest(block));entries.set(key,entry);
 }
 return new Map([...entries].map(([key,{kind,schema,parts}])=>[key,{kind,schema,digest:digest(parts.sort().join('\n'))}]));
}

/** @param {string} sql */
export function rememberRecoverySchema(sql){
 const sha256=digest(sql);
 snapshots.delete(sha256);snapshots.set(sha256,summarize(sql));
 if(snapshots.size>maximumSnapshots)snapshots.delete(snapshots.keys().next().value);
 return sha256;
}

/**
 * @param {string} expectedDigest
 * @param {string} actualSql
 * @param {{schemaVersion:number,roleOrderMatches?:boolean|null}} options
 */
export function recoverySchemaDifference(expectedDigest,actualSql,{schemaVersion,roleOrderMatches=null}){
 const expected=snapshots.get(expectedDigest),actual=summarize(actualSql),differences=[];
 if(expected){
  for(const key of new Set([...expected.keys(),...actual.keys()])){
   const before=expected.get(key),after=actual.get(key);
   if(before?.digest===after?.digest)continue;
   differences.push({objectIdentitySha256:key,kind:(after??before).kind,schema:(after??before).schema,
    change:!before?'added':!after?'removed':'changed'});
  }
 }
 return {formatVersion:1,schemaVersion,expectedDigest,actualDigest:digest(actualSql),sourceEvidenceAvailable:!!expected,
  roleOrderMatches,differenceCount:expected?differences.length:null,differences:differences.slice(0,maximumDifferences),
  truncated:differences.length>maximumDifferences};
}
