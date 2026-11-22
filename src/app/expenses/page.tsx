import {ExpensesScreen} from './expenses';
export const dynamic='force-dynamic';
export const runtime='nodejs';
export default async function ExpensesPage({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){const {view}=await searchParams;const pane=view==='suppliers'||view==='exports'?view:'purchases';return <main className="customers expenses-page"><header className="workflow-heading"><h1>Expenses</h1></header><ExpensesScreen initialPane={pane}/></main>;}
