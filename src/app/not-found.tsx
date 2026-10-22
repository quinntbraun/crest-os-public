import Link from 'next/link';

export default function NotFound(){
  return <main>
    <p className="eyebrow">Crest Detailing</p>
    <h1>Page not found</h1>
    <p>This page is unavailable.</p>
    <Link href="/">Return to Crest OS</Link>
  </main>;
}
