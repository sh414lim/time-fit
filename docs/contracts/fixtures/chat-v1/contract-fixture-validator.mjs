import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const draftDir = path.dirname(fileURLToPath(import.meta.url));
const fixtureDir = draftDir;
const knownEvents = new Set([
  'message.created',
  'conversation.updated',
  'conversation.archived',
]);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const dateTimePattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;

function readJson(fileName) {
  return JSON.parse(fs.readFileSync(path.join(fixtureDir, fileName), 'utf8'));
}

function fail(message) {
  throw new Error(message);
}

function contractFailure(code, message) {
  const error = new Error(message);
  error.contractCode = code;
  throw error;
}

function has(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function requireString(object, key) {
  if (!has(object, key) || typeof object[key] !== 'string' || object[key].length === 0) {
    contractFailure('contract_invalid', `${key} must be a non-empty string`);
  }
  return object[key];
}

function requireUuid(object, key) {
  const value = requireString(object, key);
  if (!uuidPattern.test(value)) {
    contractFailure('contract_invalid', `${key} must be a canonical UUID`);
  }
  return value;
}

function requireDateTime(object, key) {
  const value = requireString(object, key);
  if (!dateTimePattern.test(value) || Number.isNaN(Date.parse(value))) {
    contractFailure('contract_invalid', `${key} must be an ISO-8601 date-time with timezone`);
  }
  return value;
}

function decodeEvent(payload) {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    contractFailure('contract_invalid', 'event must be an object');
  }
  if (!has(payload, 'schemaVersion') || payload.schemaVersion === null) {
    contractFailure('contract_invalid', 'schemaVersion is required');
  }
  if (payload.schemaVersion !== 1) {
    contractFailure('unsupported_schema_version', 'only schemaVersion 1 is supported');
  }

  requireUuid(payload, 'eventId');
  const eventType = requireString(payload, 'eventType');
  requireUuid(payload, 'conversationId');
  requireDateTime(payload, 'occurredAt');

  if (eventType === 'message.created') {
    requireUuid(payload, 'messageId');
    if (!has(payload, 'sequence') || !Number.isInteger(payload.sequence) || payload.sequence < 1) {
      contractFailure('contract_invalid', 'message.created sequence must be an integer >= 1');
    }
  } else if (eventType === 'conversation.updated' || eventType === 'conversation.archived') {
    if (has(payload, 'messageId') || has(payload, 'sequence')) {
      contractFailure('contract_invalid', `${eventType} forbids messageId and sequence`);
    }
  }

  return {
    kind: knownEvents.has(eventType) ? 'valid_known' : 'valid_unknown',
    eventType,
    conversationId: payload.conversationId,
  };
}

function routeEvent(decoded) {
  return decoded.eventType === 'message.created'
    ? ['get_conversation', 'gap_fill_messages']
    : ['get_conversation'];
}

function sorted(values) {
  return [...values].sort();
}

function assertSameArray(actual, expected, label) {
  if (JSON.stringify(sorted(actual)) !== JSON.stringify(sorted(expected))) {
    fail(`${label}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
}

function decodeOutcome(payload) {
  try {
    const decoded = decodeEvent(payload);
    return { expectation: decoded.kind, actions: routeEvent(decoded) };
  } catch (error) {
    if (error.contractCode) {
      return { expectation: error.contractCode, actions: [] };
    }
    throw error;
  }
}

function applyMutation(base, testCase) {
  const payload = clone(base);
  for (const key of testCase.remove ?? []) delete payload[key];
  for (const [key, value] of Object.entries(testCase.set ?? {})) payload[key] = value;
  return payload;
}

function validateDirectEventFixtures(manifest) {
  for (const fixture of manifest.fixtures) {
    const outcome = decodeOutcome(readJson(fixture.file));
    if (outcome.expectation !== fixture.expectation) {
      fail(`${fixture.file}: expected ${fixture.expectation}, received ${outcome.expectation}`);
    }
    assertSameArray(outcome.actions, fixture.actions, `${fixture.file} router`);
  }
}

function validateFieldMatrix() {
  const matrix = readJson('realtime-field-validation.cases.json');
  for (const testCase of matrix.cases) {
    const base = matrix.bases[testCase.base];
    if (!base) fail(`${testCase.name}: unknown base ${testCase.base}`);
    const outcome = decodeOutcome(applyMutation(base, testCase));
    if (outcome.expectation !== testCase.expectation) {
      fail(`${testCase.name}: expected ${testCase.expectation}, received ${outcome.expectation}`);
    }
    if (testCase.actions) {
      assertSameArray(outcome.actions, testCase.actions, `${testCase.name} router`);
    } else if (outcome.actions.length !== 0 && !testCase.expectation.startsWith('valid_')) {
      fail(`${testCase.name}: invalid payload routed actions`);
    }
  }
}

function validateNegativeRouting() {
  const matrix = readJson('realtime-routing-negative.cases.json');
  for (const testCase of matrix.cases) {
    const decoded = decodeEvent(readJson(testCase.file));
    const actions = routeEvent(decoded);
    for (const action of testCase.requiredActions) {
      if (!actions.includes(action)) fail(`${testCase.name}: missing required action ${action}`);
    }
    for (const action of testCase.forbiddenActions) {
      if (actions.includes(action)) fail(`${testCase.name}: used forbidden action ${action}`);
    }
  }
}

function decodeServerError(payload) {
  if (payload?.schemaVersion !== 1 || payload.error === null || typeof payload.error !== 'object') {
    contractFailure('contract_invalid', 'invalid server error envelope');
  }
  requireString(payload.error, 'code');
  if (typeof payload.error.retryable !== 'boolean') {
    contractFailure('contract_invalid', 'retryable must be boolean');
  }
  requireUuid(payload.error, 'requestId');
  if (payload.error.code === 'rate_limited') {
    if (!Number.isInteger(payload.error.retryAfterMs) || payload.error.retryAfterMs < 1) {
      contractFailure('contract_invalid', 'rate_limited requires retryAfterMs');
    }
  } else if (has(payload.error, 'retryAfterMs')) {
    contractFailure('contract_invalid', 'retryAfterMs is rate_limited-only');
  }
  return 'valid_server_error';
}

function decodeClientFailure(payload) {
  if (!['network', 'malformed_response'].includes(payload?.source)) {
    contractFailure('contract_invalid', 'invalid client failure source');
  }
  if (payload.code !== 'internal_error' || typeof payload.retryable !== 'boolean') {
    contractFailure('contract_invalid', 'invalid client failure');
  }
  if (has(payload, 'requestId') || has(payload, 'schemaVersion') || has(payload, 'error')) {
    contractFailure('contract_invalid', 'client failure must not impersonate a server envelope');
  }
  return 'valid_client_failure';
}

function validateErrorFixtures(manifest) {
  for (const fixture of manifest.errorFixtures) {
    const payload = readJson(fixture.file);
    let outcome;
    try {
      outcome = fixture.file.startsWith('server-')
        ? decodeServerError(payload)
        : decodeClientFailure(payload);
    } catch (error) {
      if (!error.contractCode) throw error;
      outcome = error.contractCode;
    }
    if (outcome !== fixture.expectation) {
      fail(`${fixture.file}: expected ${fixture.expectation}, received ${outcome}`);
    }
  }
}

function startRefresh(state) {
  state.inFlight = true;
  state.requestEpoch = state.epoch;
}

function runReconciliationScenario(scenario) {
  const state = {
    epoch: scenario.initial.epoch,
    localConversation: {
      status: scenario.initial.status,
      title: scenario.initial.title ?? null,
    },
    subscribed: scenario.initial.subscribed,
    outboxRunning: scenario.initial.outboxRunning,
    inFlight: false,
    dirty: false,
    purged: false,
    requestEpoch: null,
    appliedResponses: 0,
    discardedResponses: 0,
  };

  for (const step of scenario.steps) {
    if (step.op === 'event') {
      if (state.purged) continue;
      if (state.inFlight) state.dirty = true;
      else startRefresh(state);
    } else if (step.op === 'membership_lost') {
      state.epoch += 1;
      state.subscribed = false;
      state.outboxRunning = false;
      state.localConversation = null;
      state.purged = true;
      state.inFlight = false;
      state.dirty = false;
      state.requestEpoch = null;
    } else if (step.op === 'response') {
      if (step.epoch !== state.epoch || state.purged) {
        state.discardedResponses += 1;
        continue;
      }
      if (!state.inFlight || state.requestEpoch !== step.epoch) {
        fail(`${scenario.name}: response has no matching in-flight request`);
      }
      state.localConversation = clone(step.canonical);
      state.appliedResponses += 1;
      state.inFlight = false;
      state.requestEpoch = null;
      if (state.dirty) {
        state.dirty = false;
        startRefresh(state);
      }
    } else {
      fail(`${scenario.name}: unknown operation ${step.op}`);
    }
  }

  const observed = {
    ...state,
    status: state.localConversation?.status,
    title: state.localConversation?.title,
  };
  for (const [key, expectedValue] of Object.entries(scenario.expected)) {
    if (JSON.stringify(observed[key]) !== JSON.stringify(expectedValue)) {
      fail(`${scenario.name}: ${key} expected ${JSON.stringify(expectedValue)}, received ${JSON.stringify(observed[key])}`);
    }
  }
}

function validateReconciliation() {
  for (const scenario of readJson('reconciliation.cases.json').scenarios) {
    runReconciliationScenario(scenario);
  }
}

function localContiguousTail(sequences) {
  const values = new Set(sequences);
  let tail = 0;
  while (values.has(tail + 1)) tail += 1;
  return tail;
}

function validateGapFillTail() {
  for (const testCase of readJson('gap-fill-tail.cases.json').cases) {
    const tail = localContiguousTail(testCase.storedSequences);
    if (tail !== testCase.expectedLocalContiguousTail) {
      fail(`${testCase.name}: expected tail ${testCase.expectedLocalContiguousTail}, received ${tail}`);
    }
    if (tail === testCase.serverLatestSequence && testCase.name === 'server-latest-never-becomes-cursor') {
      fail(`${testCase.name}: accidentally used server latest sequence`);
    }
  }
}

function normalTaxonomy(result) {
  if (result === 'success') return 'success';
  if (result === 'authentication_required') return 'login';
  if (result === 'rate_limited') return 'retry_after';
  if (result === 'internal_error') return 'retry';
  return 'terminal';
}

function authAction(testCase) {
  if (testCase.initial !== 'authentication_required') return normalTaxonomy(testCase.initial);
  if (testCase.refresh !== 'succeeded') return 'login';
  if (testCase.replay === 'authentication_required') return 'login';
  return normalTaxonomy(testCase.replay);
}

function validateAuthRetry() {
  for (const testCase of readJson('auth-retry.cases.json').cases) {
    const action = authAction(testCase);
    if (action !== testCase.expectedAction) {
      fail(`${testCase.name}: expected ${testCase.expectedAction}, received ${action}`);
    }
  }
}

function validateManifestFiles(manifest) {
  const referenced = [
    ...manifest.fixtures.map((entry) => entry.file),
    ...manifest.errorFixtures.map((entry) => entry.file),
    ...manifest.matrices,
  ];
  for (const fileName of referenced) {
    if (!fs.existsSync(path.join(fixtureDir, fileName))) fail(`manifest references missing ${fileName}`);
  }
}

const manifest = readJson('manifest.json');
validateManifestFiles(manifest);
validateDirectEventFixtures(manifest);
validateFieldMatrix();
validateNegativeRouting();
validateErrorFixtures(manifest);
validateReconciliation();
validateGapFillTail();
validateAuthRetry();

console.log('CHAT-000 contract decoder/router/reconciliation fixtures validated.');
