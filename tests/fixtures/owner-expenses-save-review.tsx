// UI-only fixture. Browser tests intercept HTTP; this is not an app sign-in.
import {createRoot} from 'react-dom/client';
import {SaveReviewScreen} from '../../src/app/save-review/review';
import type {OriginalOperationKind} from '../../src/security/original-operation-reference';
const kind=new URLSearchParams(location.search).get('kind') as OriginalOperationKind;
createRoot(document.getElementById('root')!).render(<main className="customers"><p className="eyebrow">Crest Detailing · synthetic UI test</p><h1>Interrupted save review</h1><SaveReviewScreen initialKind={kind}/></main>);
