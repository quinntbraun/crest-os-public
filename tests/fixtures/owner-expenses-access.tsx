// UI-only fixture; actual provider/SQL/browser acceptance is separate.
import {createRoot} from 'react-dom/client';
import {ExpensesScreen} from '../../src/app/expenses/expenses';
createRoot(document.getElementById('root')!).render(<main><h1>Expenses</h1><ExpensesScreen/></main>);
