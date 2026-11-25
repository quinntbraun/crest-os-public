// Data-only ACCOUNTING12/P27 identity pins shared by evidence and planning.
// A pin never creates an account, registers a control, or approves its use.
const rules={
 bank:['asset','debit','bank'],wallet:['asset','debit','wallet'],cash:['asset','debit','cash'],
 checks:['asset','debit','checks'],transfer_transit:['asset','debit','transfer_transit'],
 owner_custody:['asset','debit','owner_custody'],receivable:['asset','debit','ar'],
 customer_funds:['liability','credit','customer_funds'],supplier_payable:['liability','credit','payable'],
 tax_liability:['liability','credit','tax_payable'],debt:['liability','credit','debt'],
 due_owner:['liability','credit','due_owner'],equipment_cost:['asset','debit','fixed_asset'],
 accumulated_depreciation:['asset','credit','accumulated_depreciation'],prepaid:['asset','debit','prepaid'],
 other_asset:['asset','debit',null],other_liability:['liability','credit',null],
} as const;
for(const rule of Object.values(rules))Object.freeze(rule);
export const openingSourceAccountRules=Object.freeze(rules);
