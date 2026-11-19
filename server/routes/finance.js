import closeouts from '../api/closeouts.js';
import expenseDetail from '../api/expense-detail.js';
import expenseExceptions from '../api/expense-exceptions.js';
import expenseReminderWorker from '../api/expense-reminder-worker.js';
import expenseReview from '../api/expense-review.js';
import expenses from '../api/expenses.js';
import financeReport from '../api/finance-report.js';
import financeHub from '../api/finance-hub.js';
import granterFinanceAnalytics from '../api/granter-finance-analytics.js';
import granterFinanceSync from '../api/granter-finance-sync.js';
import receiptProcess from '../api/receipt-process.js';
import receiptAx from '../api/receipt-ax.js';

export const financeRoutes = Object.freeze({
  closeouts,
  'expense-detail': expenseDetail,
  'expense-exceptions': expenseExceptions,
  'expense-reminder-worker': expenseReminderWorker,
  'expense-review': expenseReview,
  expenses,
  'finance-report': financeReport,
  'finance-hub': financeHub,
  'granter-finance-analytics': granterFinanceAnalytics,
  'granter-finance-sync': granterFinanceSync,
  'receipt-process': receiptProcess,
  'receipt-ax': receiptAx,
});
