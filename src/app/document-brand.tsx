import Image from 'next/image';

export function DocumentBrand(){
 return <div className="document-brand">
  <Image src="/brand/crest-detailing.png" alt="" width={144} height={144} className="document-brand-crest"/>
  <p className="eyebrow">Crest Detailing</p>
 </div>;
}
