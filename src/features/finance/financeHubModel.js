const number = value => Number(value || 0);
const dateKey = value => String(value || '').slice(0, 10);

export function monthRange(month) {
  const safe = /^\d{4}-\d{2}$/.test(month || '') ? month : new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' }).slice(0, 7);
  const [year, monthNumber] = safe.split('-').map(Number);
  return { from: `${safe}-01`, to: new Date(Date.UTC(year, monthNumber, 0)).toISOString().slice(0, 10) };
}

export function normalizeFinanceHubData({ expenses = [], cards = [], cardTransactions = [], bankAccounts = [], bankTransactions = [], documents = [] } = {}) {
  const expensesByCardGroup = new Map();
  for (const expense of expenses) {
    for (const source of expense.sources || []) {
      if (source.source_type === 'card_transaction_group') expensesByCardGroup.set(String(source.source_id), expense);
    }
  }
  const receiptIdsByExpense = new Map(expenses.map(expense => [expense.id, new Set((expense.sources || []).filter(source => source.source_type === 'receipt').map(source => String(source.source_id)))]));
  const cardRows = cardTransactions.map(transaction => {
    const expense = expensesByCardGroup.get(String(transaction.id));
    const cancelled = transaction.status === 'cancelled' || number(transaction.net_amount) < 0;
    return {
      id: `card:${transaction.id}`, sourceId: transaction.id, type: 'card', sourceLabel: '법인카드', occurredAt: transaction.approved_at,
      date: dateKey(transaction.approved_at), direction: cancelled ? 'deposit' : 'withdrawal', amount: Math.abs(number(transaction.net_amount || transaction.amount)),
      merchant: transaction.merchant_name || '사용처 미확인', description: transaction.approval_number ? `승인 ${transaction.approval_number}` : '',
      category: expense?.category || '미분류', evidence: expense && receiptIdsByExpense.get(expense.id)?.size ? 'complete' : expense?.status === 'review_required' ? 'review' : 'missing',
      status: transaction.status || 'pending', asset: transaction.card ? `${transaction.card.nickname || transaction.card.issuer} •••• ${transaction.card.last4}` : '법인카드',
      cardId: transaction.corporate_card_id, expenseId: expense?.id || null,
    };
  });
  const linkedExpenseIds = new Set([...expensesByCardGroup.values()].map(expense => expense.id));
  const manualRows = expenses.filter(expense => !linkedExpenseIds.has(expense.id) && expense.status !== 'excluded').map(expense => ({
    id: `expense:${expense.id}`, sourceId: expense.id, type: 'expense', sourceLabel: '지출 원장', occurredAt: `${expense.transaction_date}T12:00:00+09:00`, date: expense.transaction_date,
    direction: 'withdrawal', amount: number(expense.total_amount), merchant: expense.merchant_name || '사용처 미확인', description: expense.reason || '', category: expense.category || '미분류',
    evidence: receiptIdsByExpense.get(expense.id)?.size ? 'complete' : expense.status === 'review_required' ? 'review' : 'missing', status: expense.status,
    asset: (expense.sources || []).some(source => source.source_type === 'manual') ? '직접 등록' : '영수증 지출', expenseId: expense.id,
  }));
  const bankRows = bankTransactions.map(transaction => ({
    id: `bank:${transaction.id}`, sourceId: transaction.id, type: 'bank', sourceLabel: '통장', occurredAt: transaction.occurred_at, date: dateKey(transaction.occurred_at),
    direction: transaction.direction, amount: number(transaction.amount), merchant: transaction.description || (transaction.direction === 'deposit' ? '계좌 입금' : '계좌 출금'), description: transaction.description || '',
    category: '미분류', evidence: transaction.direction === 'deposit' ? 'not_required' : 'missing', status: 'synced',
    asset: transaction.account ? `${transaction.account.display_name || transaction.account.bank_name} •••• ${transaction.account.last4}` : '사업용 통장', bankAccountId: transaction.bank_account_id,
  }));
  const rows = [...cardRows, ...bankRows, ...manualRows].sort((a, b) => String(b.occurredAt).localeCompare(String(a.occurredAt)));
  const documentById = new Map(documents.map(document => [String(document.id), document]));
  const evidenceItems = expenses.map(expense => {
    const receiptIds = receiptIdsByExpense.get(expense.id) || new Set();
    const receipt = [...receiptIds].map(id => documentById.get(id)).find(Boolean);
    return { expense, receipt, state: receipt ? (receipt.review_status === 'approved' ? 'complete' : 'review') : 'missing' };
  });
  return { rows, evidenceItems, cards, bankAccounts, documents };
}

export function summarizeFinanceRows(rows = []) {
  const withdrawals = rows.filter(row => row.direction === 'withdrawal');
  const deposits = rows.filter(row => row.direction === 'deposit');
  return {
    totalExpense: withdrawals.reduce((sum, row) => sum + row.amount, 0),
    cardExpense: withdrawals.filter(row => row.type === 'card').reduce((sum, row) => sum + row.amount, 0),
    bankWithdrawal: withdrawals.filter(row => row.type === 'bank').reduce((sum, row) => sum + row.amount, 0),
    deposits: deposits.reduce((sum, row) => sum + row.amount, 0),
    missingEvidenceAmount: withdrawals.filter(row => row.evidence === 'missing' || row.evidence === 'review').reduce((sum, row) => sum + row.amount, 0),
    missingEvidenceCount: withdrawals.filter(row => row.evidence === 'missing' || row.evidence === 'review').length,
    count: rows.length,
  };
}

export function buildFinanceSeries(rows = []) {
  const daily = new Map();
  const categories = new Map();
  for (const row of rows) {
    const day = daily.get(row.date) || { date: row.date, expense: 0, deposit: 0, count: 0 };
    if (row.direction === 'withdrawal') day.expense += row.amount;
    else day.deposit += row.amount;
    day.count += 1;
    daily.set(row.date, day);
    if (row.direction === 'withdrawal') categories.set(row.category || '미분류', (categories.get(row.category || '미분류') || 0) + row.amount);
  }
  return {
    daily: [...daily.values()].sort((a, b) => a.date.localeCompare(b.date)),
    categories: [...categories.entries()].map(([name, amount]) => ({ name, amount })).sort((a, b) => b.amount - a.amount),
  };
}
