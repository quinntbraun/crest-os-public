import {ExpensesScreen} from './expenses';
import {readExpenseNavigation} from '../../client/expense-navigation';
export const dynamic='force-dynamic';
export const runtime='nodejs';
export default async function ExpensesPage({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){const context=readExpenseNavigation(await searchParams);return <main className="customers expenses-page"><header className="workflow-heading"><h1>Expenses</h1></header><ExpensesScreen initialPane={context.view} initialPayablesThrough={context.payablesThrough}/></main>;}
