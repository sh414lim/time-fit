import cardConnectionAssets from '../server/api/card-connection-assets.js';
import bankConnections from '../server/api/bank-connections.js';
import bankTransactions from '../server/api/bank-transactions.js';
import cardConnectionHistory from '../server/api/card-connection-history.js';
import cardConnectionReauth from '../server/api/card-connection-reauth.js';
import cardConnections from '../server/api/card-connections.js';
import cardSync from '../server/api/card-sync.js';
import cardSyncExecute from '../server/api/card-sync-execute.js';
import cardSyncWorker from '../server/api/card-sync-worker.js';
import checkAttendanceAlerts from '../server/api/check-attendance-alerts.js';
import closeouts from '../server/api/closeouts.js';
import expenseDetail from '../server/api/expense-detail.js';
import expenseExceptions from '../server/api/expense-exceptions.js';
import expenseReminderWorker from '../server/api/expense-reminder-worker.js';
import expenseReview from '../server/api/expense-review.js';
import expenses from '../server/api/expenses.js';
import financeReport from '../server/api/finance-report.js';
import menuSalesDashboard from '../server/api/menu-sales-dashboard.js';
import organizationSalesDashboard from '../server/api/organization-sales-dashboard.js';
import payrollNotifications from '../server/api/payroll-notifications.js';
import receiptProcess from '../server/api/receipt-process.js';
import salesDashboard from '../server/api/sales-dashboard.js';
import sendSettlementEmail from '../server/api/send-settlement-email.js';
import staffSensitiveProfile from '../server/api/staff-sensitive-profile.js';
import syncSales from '../server/api/sync-sales.js';
import tossplace from '../server/api/tossplace.js';
import tossplaceBootstrapConnection from '../server/api/tossplace-bootstrap-connection.js';
import tossplaceCustomCredentials from '../server/api/tossplace-custom-credentials.js';

const handlers = {
  'bank-connections': bankConnections,
  'bank-transactions': bankTransactions,
  'card-connection-assets': cardConnectionAssets,
  'card-connection-history': cardConnectionHistory,
  'card-connection-reauth': cardConnectionReauth,
  'card-connections': cardConnections,
  'card-sync': cardSync,
  'card-sync-execute': cardSyncExecute,
  'card-sync-worker': cardSyncWorker,
  'check-attendance-alerts': checkAttendanceAlerts,
  closeouts,
  'expense-detail': expenseDetail,
  'expense-exceptions': expenseExceptions,
  'expense-reminder-worker': expenseReminderWorker,
  'expense-review': expenseReview,
  expenses,
  'finance-report': financeReport,
  'menu-sales-dashboard': menuSalesDashboard,
  'organization-sales-dashboard': organizationSalesDashboard,
  'payroll-notifications': payrollNotifications,
  'receipt-process': receiptProcess,
  'sales-dashboard': salesDashboard,
  'send-settlement-email': sendSettlementEmail,
  'staff-sensitive-profile': staffSensitiveProfile,
  'sync-sales': syncSales,
  tossplace,
  'tossplace-bootstrap-connection': tossplaceBootstrapConnection,
  'tossplace-custom-credentials': tossplaceCustomCredentials,
};

export default async function handler(req, res) {
  const queryRoute = Array.isArray(req.query?.route) ? req.query.route.join('/') : String(req.query?.route || '');
  const route = queryRoute || String(req.url || '').split('?')[0].replace(/^\/api\//, '').replace(/^\/+|\/+$/g, '');
  const target = handlers[route];
  if (!target) return res.status(404).json({ ok: false, error: 'API route not found' });
  return target(req, res);
}
