import {CustomerScreen} from './customers';
export const dynamic='force-dynamic';
export const runtime='nodejs';
export default function CustomersPage(){return <main className="customers customer-directory-page"><h1>Customers</h1><CustomerScreen/></main>;}
