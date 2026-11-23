// Closed version pairs. A new schema/profile requires explicit review; a
// request cannot relabel an old export as a current database snapshot.
export type SourceExportProfileBinding=Readonly<{profile:'crest.business-source-journal-bundle.v1';sourceSchemaVersion:43}>|Readonly<{profile:'crest.current-business-source-bundle.v1';sourceSchemaVersion:134|135}>;
export function sourceExportProfileMatches(profile:unknown,schema:unknown){
 return profile==='crest.business-source-journal-bundle.v1'&&schema===43||profile==='crest.current-business-source-bundle.v1'&&(schema===134||schema===135);
}
