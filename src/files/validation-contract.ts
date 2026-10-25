// Wire versions only. Importing the dispatcher must not load a native decoder.
export const imageValidationVersion='crest-image-v1-sharp-0.35.5';
export const pdfValidationVersion='crest-pdf-v1-qpdf-12.4.2-pdfium-3.0.0';
export const heicValidationVersion='crest-heic-v1-libheif-1.23.6-libde265-1.1.3-sharp-0.35.5';
export const fileTypes=['image/jpeg','image/png','image/heic','application/pdf'] as const;
export type FileType=typeof fileTypes[number];
export type ValidatedFile={validationVersion:string;source:Record<string,string|number> & {sha256:string;byteSize:number;detectedType:FileType};
  preview:{bytes:Buffer;sha256:string;byteSize:number;contentType:'image/jpeg';width:number;height:number;pageNumber?:number}};
