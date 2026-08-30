import {
  DEFAULT_FEEDBACK,
  KPI_CATALOG,
  PERSONAS,
  SCENARIOS,
  SEMANTIC_CONTRACT,
  SOURCE_CATALOG,
} from './demoData.js';

const DEFAULT_SCENARIO_ID = 'revenue-drop';
const DEFAULT_PERSONA_ID = 'executive';

function clamp(value, minimum = 0, maximum = 1) {
  return Math.min(maximum, Math.max(minimum, value));
}

function round(value, places = 2) {
  const multiplier = 10 ** places;
  return Math.round(value * multiplier) / multiplier;
}

function sum(values) {
  return values.reduce((total, value) => total + value, 0);
}

export function getPersona(personaId = DEFAULT_PERSONA_ID) {
  return PERSONAS[personaId] ?? PERSONAS[DEFAULT_PERSONA_ID];
}

export function getScenario(scenarioId = DEFAULT_SCENARIO_ID) {
  return SCENARIOS[scenarioId] ?? SCENARIOS[DEFAULT_SCENARIO_ID];
}

export function getScenarioSummaries() {
  return Object.values(SCENARIOS).map((scenario) => ({
    id: scenario.id,
    label: scenario.label,
    description: scenario.description,
    status: scenario.confidence.status,
    confidence: scenario.confidence,
    primaryKpiId: scenario.primaryKpiId,
    periodLabel: scenario.periodLabel,
  }));
}

export function getFeedbackSummary(events = DEFAULT_FEEDBACK) {
  const byDriver = {};
  const byLabel = {};

  for (const event of events) {
    if (event.driverId) {
      byDriver[event.driverId] ??= { confirmed: 0, useful: 0, needsReview: 0, total: 0 };
      const bucket = byDriver[event.driverId];
      bucket.total += 1;
      if (event.label === 'confirmed-driver') bucket.confirmed += 1;
      if (event.label === 'useful') bucket.useful += 1;
      if (event.label === 'needs-review') bucket.needsReview += 1;
    }
    byLabel[event.label] = (byLabel[event.label] ?? 0) + 1;
  }

  const topDriver = Object.entries(byDriver)
    .sort(([, left], [, right]) => (right.confirmed + right.useful) - (left.confirmed + left.useful))[0];

  return {
    total: events.length,
    thisWeek: events.length,
    byDriver,
    byLabel,
    topDriver: topDriver ? { id: topDriver[0], positiveSignals: topDriver[1].confirmed + topDriver[1].useful } : null,
    status: events.length ? 'capturing' : 'ready-for-feedback',
    learningNote: events.length
      ? 'Feedback changes ranking boosts in this demo process; production promotion would require offline evaluation and approval.'
      : 'No feedback has been captured yet.',
  };
}

function feedbackBoost(driverId, feedbackSummary) {
  const feedback = feedbackSummary.byDriver?.[driverId];
  if (!feedback) return 0;
  return (feedback.confirmed * 2) + feedback.useful - (feedback.needsReview * 2);
}

function rankDrivers(scenario, feedbackSummary) {
  const rawDrivers = scenario.drivers.map((driver) => {
    const boost = feedbackBoost(driver.id, feedbackSummary);
    return {
      ...driver,
      feedbackBoost: boost,
      rankingScore: round(driver.contributionPercent + boost, 1),
    };
  });

  return rawDrivers
    .sort((left, right) => right.rankingScore - left.rankingScore)
    .map((driver, index) => ({
      ...driver,
      rank: index + 1,
      rankExplanation: driver.feedbackBoost
        ? `${driver.feedbackBoost > 0 ? '+' : ''}${driver.feedbackBoost} feedback ranking points`
        : 'Contribution score only; no feedback adjustment',
    }));
}

function buildSources(scenario) {
  return SOURCE_CATALOG.map((source) => {
    if (scenario.id !== 'contradictory-evidence' || source.id !== 'marketing-platform') {
      return { ...source, scenarioStatus: source.freshnessStatus, scenarioNote: 'Within source SLA.' };
    }

    return {
      ...source,
      ageMinutes: 1560,
      freshnessLabel: '26h stale',
      freshnessStatus: 'stale',
      sla: 'outside 2h SLA',
      qualityScore: 82.1,
      scenarioStatus: 'stale',
      scenarioNote: 'Two hourly loads are missing; excluded from causal ranking.',
    };
  });
}

function buildAccess(persona) {
  const allowedDomains = new Set(persona.allowedDomains);
  const visibleSources = SOURCE_CATALOG
    .filter((source) => allowedDomains.has(source.domain.toLowerCase()))
    .map((source) => source.id);

  return {
    role: persona.id,
    roleLabel: persona.label,
    identitySource: 'Demo identity header mapped by server policy',
    allowedScope: persona.homeScope,
    scopeType: persona.scope,
    decisionRights: persona.decisionRights,
    allowedDomains: persona.allowedDomains,
    visibleSources,
    visibleColumns: ['kpi_value', 'driver_contribution', 'action_owner', 'monitoring_plan'],
    redactedColumns: persona.restrictedFields,
    policyRule: persona.scope === 'store'
      ? 'row filter: store_id = store-042; marketing and supplier domains are not exposed'
      : 'row filter: region_id = north; sensitive customer and supplier columns are redacted',
    auditEvent: `READ /api/dashboard · role=${persona.id} · scope=${persona.scope}`,
  };
}

function buildNarrative(scenario, persona, drivers, actions) {
  const top = drivers[0];
  const second = drivers[1];
  const actionOwner = actions[0]?.owner ?? 'assigned owner';

  if (scenario.confidence.status === 'abstain') {
    const base = `The engine found a ${Math.abs(scenario.changePercent)}% revenue movement, but it is not safe to call a cause yet. ${scenario.confidence.reason}`;
    if (persona.id === 'store-manager') {
      return {
        title: 'Pause store-level action until the feeds agree',
        summary: `${base} Store 042 can continue normal service and report stock or checkout issues, but should not change local promotions from this signal.`,
        decision: 'Hold current operating plan; escalate data reconciliation.',
        whyItMatters: 'A stale or mismatched denominator can turn a normal day into a false alarm.',
        firstMove: 'Keep current campaigns and merchandising unchanged while the data owner reconciles cohorts.',
      };
    }
    if (persona.id === 'marketing-analyst') {
      return {
        title: 'Reconcile attribution before changing spend',
        summary: `${base} POS says completed orders fell while attribution says they grew, and the feeds are not comparable yet.`,
        decision: 'Open a data-quality investigation; do not pause or scale on this insight.',
        whyItMatters: 'A wrong attribution denominator can create an expensive false optimization.',
        firstMove: 'Compare click IDs, pilot-audience membership, and the two missing hourly loads.',
      };
    }
    return {
      title: 'Do not make a regional budget move yet',
      summary: `${base} The safe executive decision is to preserve the current plan while the source owners restore agreement.`,
      decision: 'Approve reconciliation time, not a campaign or inventory intervention.',
      whyItMatters: 'The reported movement is borderline on business impact and fails source-agreement checks.',
      firstMove: 'Assign Marketing Analytics and Data Engineering to reconcile cohorts and freshness.',
    };
  }

  if (scenario.confidence.status === 'clarify') {
    const base = `The launch is showing ${Math.abs(scenario.changePercent)}% growth, but only ${scenario.comparableDays} comparable days exist. ${scenario.confidence.reason}`;
    if (persona.id === 'store-manager') {
      return {
        title: 'Collect signal; keep the pilot steady',
        summary: `${base} Store 042 is a useful observation point, not proof that the assortment should scale.`,
        decision: 'Keep the current pilot assortment and log customer objections for seven more days.',
        whyItMatters: 'Early adopter mix can make a launch look stronger or weaker than its repeat behavior.',
        firstMove: 'Tag objections, bundle requests, and stock gaps during each shift.',
      };
    }
    if (persona.id === 'marketing-analyst') {
      return {
        title: 'Treat growth as a launch signal, not a trend',
        summary: `${base} Channel mix changed on four of the 11 days, so scaling now would confound the experiment.`,
        decision: 'Keep budget at the current cap and finish the baseline window.',
        whyItMatters: 'A stable cohort is needed before optimizing channel or creative performance.',
        firstMove: 'Confirm cohort rules and monitor repeat rate, not only first-order revenue.',
      };
    }
    return {
      title: 'Protect the experiment while history accrues',
      summary: `${base} The positive signal is worth monitoring, but it is not yet a reliable forecast or scale recommendation.`,
      decision: 'Hold the pilot budget and assortment unchanged for seven more days.',
      whyItMatters: 'Sparse history makes both seasonality and repeat behavior unknown.',
      firstMove: 'Confirm the launch baseline and pilot-store inclusion rule.',
    };
  }

  if (persona.id === 'store-manager') {
    return {
      title: `Store 042 can recover the biggest gap through availability`,
      summary: `Revenue is down ${Math.abs(scenario.changePercent)}% in the region. In the store view, ${top.label.toLowerCase()} is the largest modeled contributor; volume follows because customers cannot buy unavailable items.`,
      decision: `Prioritize the at-risk SKU transfer and validate the new display before the next peak window.`,
      whyItMatters: `${top.signal} ${second.label} is a downstream effect, so a promotion change alone would be less efficient.`,
      firstMove: 'Check the 12-SKU availability list, request transfers, then watch in-stock and AOV every four hours.',
    };
  }

  if (persona.id === 'marketing-analyst') {
    return {
      title: 'Protect efficient demand while supply recovers',
      summary: `Revenue is down ${Math.abs(scenario.changePercent)}%, but paid demand is a secondary ${scenario.drivers.find((driver) => driver.id === 'paid-demand')?.contributionPercent ?? 0}% contributor. The largest signal is ${top.label.toLowerCase()}, so broad spend cuts could hide the real constraint.`,
      decision: 'Keep efficient campaigns live, cap waste on unavailable products, and reconcile stock-aware ROAS.',
      whyItMatters: `${top.signal} ${second.signal}`,
      firstMove: 'Apply an availability-aware product filter and compare paid conversion with stock coverage.',
    };
  }

  return {
    title: 'Revenue is down, with availability leading the bridge',
    summary: `Net revenue is ${Math.abs(scenario.changePercent)}% below the comparable baseline. The deterministic bridge assigns ${top.contributionPercent}% to ${top.label.toLowerCase()}, followed by ${second.contributionPercent}% to ${second.label.toLowerCase()}.`,
    decision: `Prioritize ${actionOwner.toLowerCase()} to recover availability before reallocating more demand budget.`,
    whyItMatters: `${top.signal} The evidence is aligned across sales, inventory, and marketing, so this is actionable with ${Math.round(scenario.confidence.score * 100)}% calibrated confidence.`,
    firstMove: 'Approve the top controllable action, then monitor its named KPI before expanding the intervention.',
  };
}

function buildMethodTrace(scenario, persona) {
  const isAbstaining = scenario.confidence.status === 'abstain';
  const isSparse = scenario.confidence.status === 'clarify';

  return [
    {
      id: 'aggregate',
      stage: '01',
      label: 'Reconcile sources',
      method: 'Deterministic SQL-shaped aggregation',
      detail: 'Aligns calendar, grain, cohort, and entitlement scope before comparing periods.',
      output: `${SOURCE_CATALOG.length} source snapshots checked · ${isAbstaining ? '1 stale' : 'all in scope'}`,
      llm: false,
    },
    {
      id: 'materiality',
      stage: '02',
      label: 'Test materiality',
      method: 'Business rules + statistical baseline',
      detail: 'Combines absolute business impact, relative change, z-score, and data-quality gates.',
      output: `${scenario.materiality.absoluteImpact} impact · ${scenario.materiality.relative} change · z-score ${scenario.zScore ?? 'not available'}`,
      llm: false,
    },
    {
      id: 'drivers',
      stage: '03',
      label: 'Rank drivers',
      method: 'Contribution analysis / PVM bridge',
      detail: isAbstaining ? 'Preserves competing hypotheses for review; blocks causal language.' : isSparse ? 'Uses a coverage-adjusted signal; sparse history caps confidence.' : 'Decomposes the KPI delta into price, volume, mix, availability, and demand signals.',
      output: `${scenario.drivers.length} candidate drivers · ${scenario.contradictions.length} contradictions`,
      llm: false,
    },
    {
      id: 'retrieval',
      stage: '04',
      label: 'Retrieve levers',
      method: 'Governed action catalog',
      detail: `Filters approved levers by ${persona.label} decision rights and evidence status.`,
      output: `${scenario.actions.filter((action) => action.rights.includes(persona.id)).length} actions visible · owner and monitor required`,
      llm: false,
    },
    {
      id: 'narrative',
      stage: '05',
      label: 'Render narrative',
      method: 'Deterministic persona template',
      detail: 'Uses only the structured evidence object; no model is allowed to invent a number or driver.',
      output: `persona=${persona.id} · ${isAbstaining || isSparse ? 'abstention/clarification preserved' : 'actionable narrative'}`,
      llm: false,
    },
  ];
}

function buildLineage(scenario, primaryKpi) {
  return [
    { node: 'Source snapshots', detail: 'ERP order lines · WMS intervals · hourly campaign stats', kind: 'source' },
    { node: primaryKpi.label, detail: primaryKpi.formula, kind: 'semantic' },
    { node: 'Movement gate', detail: `${scenario.periodLabel} · ${scenario.baselineType}`, kind: 'rule' },
    { node: 'Evidence bridge', detail: `${scenario.drivers.length} drivers · ${scenario.evidence.length} evidence items`, kind: 'analysis' },
    { node: 'Decision narrative', detail: 'Persona + entitlement filtered output', kind: 'delivery' },
  ];
}

export function buildDashboard({ scenarioId = DEFAULT_SCENARIO_ID, personaId = DEFAULT_PERSONA_ID, feedbackEvents = DEFAULT_FEEDBACK, telemetry = null } = {}) {
  const scenario = getScenario(scenarioId);
  const persona = getPersona(personaId);
  const feedback = getFeedbackSummary(feedbackEvents);
  const primaryKpi = KPI_CATALOG.find((kpi) => kpi.id === scenario.primaryKpiId) ?? KPI_CATALOG[0];
  const drivers = rankDrivers(scenario, feedback);
  const visibleActions = scenario.actions
    .filter((action) => action.rights.includes(persona.id))
    .map((action) => ({ ...action, visibleBecause: `${persona.label} can exercise ${action.lever.toLowerCase()} decision rights.` }));
  const sources = buildSources(scenario);
  const evidence = scenario.evidence.map((item) => {
    const source = sources.find((candidate) => candidate.id === item.sourceId);
    return { ...item, sourceName: source?.name, sourceFreshness: source?.freshnessLabel, sourceStatus: source?.scenarioStatus };
  });

  return {
    generatedAt: new Date().toISOString(),
    prototype: true,
    scenario: {
      id: scenario.id,
      label: scenario.label,
      description: scenario.description,
      periodLabel: scenario.periodLabel,
      primaryKpiId: scenario.primaryKpiId,
      headline: scenario.headline,
      subheadline: scenario.subheadline,
      observed: scenario.observed,
      baseline: scenario.baseline,
      delta: scenario.delta,
      changePercent: scenario.changePercent,
      zScore: scenario.zScore,
      historyDays: scenario.historyDays,
      comparableDays: scenario.comparableDays,
      baselineType: scenario.baselineType,
      materiality: scenario.materiality,
      confidence: scenario.confidence,
      sparseHistory: scenario.sparseHistory,
      contradictions: scenario.contradictions,
      clarification: scenario.clarification ?? null,
    },
    persona: {
      id: persona.id,
      label: persona.label,
      description: persona.description,
      scope: persona.homeScope,
    },
    kpis: scenario.kpis.map((kpi) => {
      const definition = KPI_CATALOG.find((candidate) => candidate.id === kpi.id);
      return { ...kpi, label: definition?.shortLabel ?? kpi.id, fullLabel: definition?.label, unit: definition?.unit };
    }),
    insight: {
      id: `${scenario.id}:${persona.id}`,
      status: scenario.confidence.status,
      confidence: scenario.confidence,
      headline: scenario.headline,
      narrative: buildNarrative(scenario, persona, drivers, visibleActions),
      drivers,
      evidence,
      actions: visibleActions,
      clarification: scenario.clarification ?? null,
      alternatives: scenario.contradictions.length
        ? ['Demand genuinely changed', 'Attribution denominator is wrong', 'Cohorts are not comparable']
        : [],
    },
    sources,
    semanticContract: {
      ...SEMANTIC_CONTRACT,
      kpis: SEMANTIC_CONTRACT.kpis.map((kpi) => ({
        ...kpi,
        visible: kpi.access[persona.id] !== 'restricted',
        accessForPersona: kpi.access[persona.id],
      })),
    },
    methodTrace: buildMethodTrace(scenario, persona),
    lineage: buildLineage(scenario, primaryKpi),
    access: buildAccess(persona),
    feedback,
    telemetry: telemetry ?? {
      requestCount: 0,
      lastLatencyMs: null,
      p95LatencyMs: null,
      modelCalls: 0,
      tokens: { input: 0, output: 0, total: 0 },
      estimatedCostUsd: 0,
      lastRoute: null,
      note: 'No LLM calls in this prototype. Narrative uses the structured evidence object.',
    },
  };
}

export function listKpisForContract() {
  return KPI_CATALOG;
}

export function listSources() {
  return SOURCE_CATALOG;
}

export function listAccessPolicies() {
  return Object.values(PERSONAS).map(buildAccess);
}

export function normalizeFeedback(body = {}) {
  const allowedLabels = new Set(['useful', 'needs-review', 'confirmed-driver']);
  const label = allowedLabels.has(body.label) ? body.label : null;
  const scenarioId = SCENARIOS[body.scenarioId] ? body.scenarioId : DEFAULT_SCENARIO_ID;
  const personaId = PERSONAS[body.personaId] ? body.personaId : DEFAULT_PERSONA_ID;
  if (!label) return { error: 'label must be useful, needs-review, or confirmed-driver' };

  return {
    value: {
      id: `feedback-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      scenarioId,
      personaId,
      insightId: typeof body.insightId === 'string' ? body.insightId.slice(0, 120) : `${scenarioId}:${personaId}`,
      label,
      driverId: typeof body.driverId === 'string' ? body.driverId.slice(0, 80) : null,
      comment: typeof body.comment === 'string' ? body.comment.slice(0, 280) : null,
      createdAt: new Date().toISOString(),
    },
  };
}

export function calculateStageTelemetry(methodTrace, elapsedMs) {
  const base = Math.max(1, elapsedMs / methodTrace.length);
  return {
    stages: methodTrace.map((stage, index) => ({
      stage: stage.label,
      method: stage.method,
      durationMs: round(base * (0.72 + ((index + 1) * 0.08)), 1),
      modelCalls: 0,
      tokens: 0,
    })),
    modelCalls: 0,
    tokens: { input: 0, output: 0, total: 0 },
    estimatedCostUsd: 0,
  };
}

export function getDefaultFeedback() {
  return DEFAULT_FEEDBACK.map((event) => ({ ...event }));
}

export function calculateContributionCoverage(drivers) {
  return round(sum(drivers.map((driver) => driver.contributionPercent)), 1);
}

export function confidenceColor(status) {
  if (status === 'ready') return 'green';
  if (status === 'clarify') return 'amber';
  return 'red';
}

export { clamp, round };
