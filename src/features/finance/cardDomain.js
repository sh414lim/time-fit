export const CARD_EVENT_TYPES = Object.freeze({
  APPROVAL: 'approval',
  CANCELLATION: 'cancellation',
  PARTIAL_CANCELLATION: 'partial_cancellation',
  ACQUISITION: 'acquisition',
  BILLING: 'billing',
  PAYMENT: 'payment',
});

const asWon = value => {
  const amount = Number(value);
  if (!Number.isSafeInteger(amount) || amount < 0) throw new Error('card_event_amount_invalid');
  return amount;
};

const byOccurredAt = (left, right) => new Date(left.occurredAt).getTime() - new Date(right.occurredAt).getTime();

export function buildCardEventKey(event) {
  if (!event.organizationId || !event.provider || !event.providerEventId) throw new Error('card_event_identity_missing');
  return `${event.organizationId}:${event.provider}:${event.providerEventId}`;
}

export function deduplicateCardEvents(events) {
  const unique = new Map();
  events.forEach(event => {
    const key = buildCardEventKey(event);
    if (!unique.has(key)) unique.set(key, event);
  });
  return [...unique.values()].sort(byOccurredAt);
}

export function summarizeCardEvents(events) {
  const ordered = deduplicateCardEvents(events);
  let approvedAmount = 0;
  let acquiredAmount = 0;
  let cancelledAmount = 0;
  let billedAmount = null;

  ordered.forEach(event => {
    const amount = asWon(event.amount);
    if (event.eventType === CARD_EVENT_TYPES.APPROVAL) approvedAmount += amount;
    if (event.eventType === CARD_EVENT_TYPES.ACQUISITION) acquiredAmount = amount;
    if (event.eventType === CARD_EVENT_TYPES.CANCELLATION || event.eventType === CARD_EVENT_TYPES.PARTIAL_CANCELLATION) cancelledAmount += amount;
    if (event.eventType === CARD_EVENT_TYPES.BILLING) billedAmount = amount;
  });

  const baseAmount = billedAmount ?? (acquiredAmount || approvedAmount);
  const netAmount = Math.max(0, baseAmount - cancelledAmount);
  let status = acquiredAmount > 0 ? 'acquired' : 'pending';
  if (billedAmount !== null) status = 'billed';
  if (cancelledAmount > 0 && netAmount > 0) status = 'partially_cancelled';
  if (cancelledAmount > 0 && netAmount === 0) status = 'cancelled';

  return { approvedAmount, acquiredAmount, cancelledAmount, billedAmount, netAmount, status, eventCount: ordered.length };
}

export function calculateOperatingProfit({ netSales = 0, confirmedOperatingExpenses = 0, actualLaborCost = 0 }) {
  const values = [netSales, confirmedOperatingExpenses, actualLaborCost].map(Number);
  if (values.some(value => !Number.isSafeInteger(value))) throw new Error('operating_profit_input_invalid');
  return values[0] - values[1] - values[2];
}
