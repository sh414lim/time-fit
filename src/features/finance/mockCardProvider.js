import { CARD_EVENT_TYPES } from './cardDomain.js';

const MOCK_CARD_ID = 'mock-card-butter-villa-4821';

export const mockCardProvider = Object.freeze({
  name: 'mock',
  async authenticate() {
    return { credentialReference: 'mock:credential:local-only', expiresAt: null };
  },
  async listCards() {
    return [{ providerCardId: MOCK_CARD_ID, issuer: 'TimeFit 테스트카드', name: '매장 운영비', last4: '4821', status: 'active' }];
  },
  async fetchEvents({ organizationId = 'mock-organization' } = {}) {
    return [
      { organizationId, provider: 'mock', providerEventId: 'approval-001', providerCardId: MOCK_CARD_ID, eventType: CARD_EVENT_TYPES.APPROVAL, occurredAt: '2026-09-10T09:30:00+09:00', amount: 120000, approvalNumber: '100001', merchantName: '식자재마트' },
      { organizationId, provider: 'mock', providerEventId: 'cancel-001', originalProviderEventId: 'approval-001', providerCardId: MOCK_CARD_ID, eventType: CARD_EVENT_TYPES.PARTIAL_CANCELLATION, occurredAt: '2026-09-10T10:10:00+09:00', amount: 20000, approvalNumber: '100001', merchantName: '식자재마트' },
      { organizationId, provider: 'mock', providerEventId: 'acquire-001', originalProviderEventId: 'approval-001', providerCardId: MOCK_CARD_ID, eventType: CARD_EVENT_TYPES.ACQUISITION, occurredAt: '2026-09-11T03:00:00+09:00', amount: 120000, approvalNumber: '100001', merchantName: '식자재마트' },
    ];
  },
});

