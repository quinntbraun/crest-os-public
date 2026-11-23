// Synthetic configuration only. No provider account or actual credential.
import {randomUUID,randomBytes} from 'node:crypto';
import {join,resolve} from 'node:path';
export function recoveryCaptureProfileFixture(root=resolve('.local/capture-profile-fixture')){
 const secret=()=>randomBytes(24).toString('base64url'),source=name=>({accountId:randomBytes(16).toString('hex'),bucket:'crest-test-'+name,accessKeyId:secret(),secretAccessKey:secret()});
 const database=new URL('postgresql://crest_capture_fixture@database.example.test/crest');database.password=secret();
 return{schemaVersion:1,businessId:randomUUID(),referenceDirectoryId:randomUUID(),databaseUrl:database.toString(),rootCertificateFile:join(root,'database-ca.pem'),recipient:'age1'+'q'.repeat(58),retentionDays:35,stateDirectory:join(root,'state'),workspaceDirectory:join(root,'work'),recipeFile:join(root,'recipe.json'),distribution:{manifestFile:join(root,'manifest.json'),sourceFile:join(root,'source.tar'),imageFile:join(root,'image.tar'),partByteSize:8*1024*1024},tools:{pgDump:join(root,'pg_dump'),age:join(root,'age')},sources:{expense_receipt:source('receipt'),supplier_document:source('supplier'),condition_photo:source('photo')},vault:{region:'us-west-004',endpoint:'https://s3.us-west-004.backblazeb2.com',bucket:'crest-test-vault',accessKeyId:secret(),secretAccessKey:secret()},monitorPingUrl:'https://hc-ping.com/'+randomUUID()};
}
