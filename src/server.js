import express from 'express';
import cors from 'cors';
import { performance } from 'node:perf_hooks';
import {
  buildDashboard,
  calculateStageTelemetry,
  getDefaultFeedback,
  getFeedbackSummary,
  getPersona,
  getScenario,
  getScenarioSummaries,
  listAccessPolicies,
  listKpisForContract,
  listSources,
  normalizeFeedback,
} from './intelligence.js';
import { PERSONAS, SEMANTIC_CONTRACT } from './demoData.js';

const app = express();
const port = Number(process.env.PORT || 4000);
const host = process.env.HOST || '127.0.0.1';

const feedbackEvents = getDefaultFeedback();
const runtime = {
  requestCount: 0,
  latencies: [],
  lastLatencyMs: null,
  lastRoute: null,
  lastAt: null,
  lastStages: [],
  modelCalls: 0,
  tokens: { input: 0, output: 0, total: 0 },
  estimatedCostUsd: 0,
};

app.use(cors({ origin: true }));
app.use(express.json({ limit: '32kb' }));

function percentile(values, percentileValue) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.ceil((percentileValue / 100) * sorted.length) - 1);
  return Number(sorted[index].toFixed(1));
}

function runtimeSnapshot() {
  return {
    requestCount: runtime.requestCount,
    lastLatencyMs: runtime.lastLatencyMs,
    p95LatencyMs: percentile(runtime.latencies, 95),
    modelCalls: runtime.modelCalls,
    tokens: runtime.tokens,
    estimatedCostUsd: runtime.estimatedCostUsd,
    lastRoute: runtime.lastRoute,
    lastAt: runtime.lastAt,
    stages: runtime.lastStages,
    note: 'No LLM calls in this prototype. Narrative uses the structured evidence object.',
  };
}

function resolveIdentity(request) {
  // Prototype-only identity shim. In production this must come from a verified SSO/JWT claim.
  const requestedRole = request.get('x-demo-role') || request.query.persona || 'executive';
  return getPersona(requestedRole);
}

function recordRuntime(request, startedAt, methodTrace) {
  const elapsedMs = Math.max(0.1, performance.now() - startedAt);
  runtime.requestCount += 1;
  runtime.lastLatencyMs = Number(elapsedMs.toFixed(1));
  runtime.latencies.push(elapsedMs);
  if (runtime.latencies.length > 100) runtime.latencies.shift();
  runtime.lastRoute = `${request.method} ${request.path}`;
  runtime.lastAt = new Date().toISOString();
  runtime.lastStages = calculateStageTelemetry(methodTrace, elapsedMs).stages;
  return elapsedMs;
}

app.get('/api/health', (request, response) => {
  response.json({ ok: true, service: 'kpi-intelligence-api', prototype: true, now: new Date().toISOString() });
});

app.get('/api/scenarios', (request, response) => {
  response.json({ scenarios: getScenarioSummaries() });
});

app.get('/api/kpis', (request, response) => {
  response.json({ kpis: listKpisForContract() });
});

app.get('/api/sources', (request, response) => {
  response.json({ sources: listSources() });
});

app.get('/api/semantic-contract', (request, response) => {
  response.json({ contract: SEMANTIC_CONTRACT });
});

app.get('/api/access', (request, response) => {
  const requestedRole = request.query.persona;
  const policies = listAccessPolicies();
  if (requestedRole && PERSONAS[requestedRole]) {
    response.json({ policy: policies.find((policy) => policy.role === requestedRole), demoOnly: true });
    return;
  }
  response.json({ policies, demoOnly: true });
});

app.get('/api/telemetry', (request, response) => {
  response.json({ telemetry: runtimeSnapshot() });
});

app.get('/api/feedback', (request, response) => {
  response.json({ summary: getFeedbackSummary(feedbackEvents), events: feedbackEvents.slice(-20) });
});

app.post('/api/feedback', (request, response) => {
  const normalized = normalizeFeedback(request.body);
  if (normalized.error) {
    response.status(400).json({ error: normalized.error });
    return;
  }

  feedbackEvents.push(normalized.value);
  if (feedbackEvents.length > 250) feedbackEvents.splice(0, feedbackEvents.length - 250);
  response.status(201).json({ ok: true, event: normalized.value, summary: getFeedbackSummary(feedbackEvents) });
});

app.get('/api/insights/:scenarioId', (request, response) => {
  const startedAt = performance.now();
  const persona = resolveIdentity(request);
  const scenario = getScenario(request.params.scenarioId);
  const dashboard = buildDashboard({
    scenarioId: scenario.id,
    personaId: persona.id,
    feedbackEvents,
    telemetry: null,
  });
  recordRuntime(request, startedAt, dashboard.methodTrace);
  dashboard.telemetry = runtimeSnapshot();
  response.json(dashboard.insight);
});

app.get('/api/dashboard', (request, response) => {
  const startedAt = performance.now();
  const persona = resolveIdentity(request);
  const scenario = getScenario(request.query.scenario);
  const dashboard = buildDashboard({
    scenarioId: scenario.id,
    personaId: persona.id,
    feedbackEvents,
    telemetry: null,
  });
  recordRuntime(request, startedAt, dashboard.methodTrace);
  dashboard.telemetry = runtimeSnapshot();
  response.json(dashboard);
});

app.use((error, request, response, next) => {
  if (error?.type === 'entity.parse.failed') {
    response.status(400).json({ error: 'Request body must be valid JSON.' });
    return;
  }
  next(error);
});

app.listen(port, host, () => {
  console.log(`KPI intelligence API listening on http://${host}:${port}`);
  console.log('Prototype mode: in-memory data, demo identity, zero LLM calls.');
});
