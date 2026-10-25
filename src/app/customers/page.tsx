import {CustomerScreen} from './customers';
export const dynamic='force-dynamic';
export const runtime='nodejs';
export default function CustomersPage(){return <main className="customers"><p className="eyebrow">Crest Detailing</p><h1>Customers</h1><CustomerScreen/></main>;}
