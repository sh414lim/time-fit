import checkAttendanceAlerts from '../api/check-attendance-alerts.js';
import operationsFeedback from '../api/operations-feedback.js';
import payrollNotifications from '../api/payroll-notifications.js';
import dispatchSchedulePush from '../api/dispatch-schedule-push.js';
import reviewCollection from '../api/review-collection.js';
import reviewPlaceSearch from '../api/review-place-search.js';
import sendSettlementEmail from '../api/send-settlement-email.js';
import staffSensitiveProfile from '../api/staff-sensitive-profile.js';

export const operationRoutes = Object.freeze({
  'check-attendance-alerts': checkAttendanceAlerts,
  'operations-feedback': operationsFeedback,
  'payroll-notifications': payrollNotifications,
  'dispatch-schedule-push': dispatchSchedulePush,
  'review-collection': reviewCollection,
  'review-place-search': reviewPlaceSearch,
  'send-settlement-email': sendSettlementEmail,
  'staff-sensitive-profile': staffSensitiveProfile,
});
