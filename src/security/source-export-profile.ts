// Closed version pairs. A new schema/profile requires explicit review; a
// request cannot relabel an old export as a current database snapshot.
export type SourceExportProfileBinding=Readonly<{profile:'crest.business-source-journal-bundle.v1';sourceSchemaVersion:43}>|Readonly<{profile:'crest.current-business-source-bundle.v1';sourceSchemaVersion:134|135|136|137|138|140|141|142}>;
export function sourceExportProfileMatches(profile:unknown,schema:unknown){
 return profile==='crest.business-source-journal-bundle.v1'&&schema===43||profile==='crest.current-business-source-bundle.v1'&&(schema===134||schema===135||schema===136||schema===137||schema===138||schema===140||(schema===141||schema===142));
}
