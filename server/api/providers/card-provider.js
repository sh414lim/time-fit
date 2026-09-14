import { mockServerCardProvider } from './mock-card-provider.js';
import { hyphenCardProvider } from './hyphen-card-provider.js';
import { codefCardProvider } from './codef-card-provider.js';

export function resolveCardProviderName(requested) {
  const configured = String(process.env.CARD_PROVIDER || '').trim().toLowerCase();
  const value = configured || String(requested || 'mock').trim().toLowerCase();
  if (process.env.NODE_ENV === 'production' && value === 'mock') throw new Error('mock_provider_disabled_in_production');
  return value;
}

export function cardProvider(name, connection = null) {
  const resolved = resolveCardProviderName(name);
  if (resolved === 'mock') return mockServerCardProvider;
  if (resolved === 'hyphen') return hyphenCardProvider(connection);
  if (resolved === 'codef') return codefCardProvider(connection);
  throw new Error('provider_not_available');
}
