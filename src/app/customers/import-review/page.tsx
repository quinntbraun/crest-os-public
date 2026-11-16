import {LegacyContactReview} from './review';

export const dynamic='force-dynamic';
export const runtime='nodejs';

export default function LegacyContactReviewPage(){
 return <main className="customers legacy-review">
  <a href="/customers">Back to customers</a>
  <h1>Review a contact CSV</h1>
  <p>Map customer and vehicle columns, then check for errors and possible matches within the file. The initial review runs in this tab.</p>
  <LegacyContactReview/>
 </main>;
}
