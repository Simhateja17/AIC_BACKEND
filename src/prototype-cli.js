import readline from 'node:readline';
import { buildDashboard, getDefaultFeedback, getFeedbackSummary, getPersona, getScenarioSummaries } from './intelligence.js';

const scenarios = getScenarioSummaries();
let scenarioIndex = 0;
let personaIndex = 0;
const personas = ['executive', 'store-manager', 'marketing-analyst'];
const feedback = getDefaultFeedback();

function render() {
  const scenario = scenarios[scenarioIndex];
  const persona = getPersona(personas[personaIndex]);
  const dashboard = buildDashboard({ scenarioId: scenario.id, personaId: persona.id, feedbackEvents: feedback });
  const top = dashboard.insight.drivers[0];

  console.clear();
  console.log('\x1b[1mKPI INTELLIGENCE → ACTION · LOGIC PROTOTYPE\x1b[0m');
  console.log('\x1b[2mQuestion: does the evidence contract lead to a safe action or a useful abstention?\x1b[0m\n');
  console.log(`\x1b[1mScenario\x1b[0m  ${scenario.label} · ${scenario.periodLabel}`);
  console.log(`\x1b[1mPersona\x1b[0m   ${persona.label} · ${persona.homeScope}`);
  console.log(`\x1b[1mState\x1b[0m     ${dashboard.insight.status} · confidence ${Math.round(dashboard.insight.confidence.score * 100)}%`);
  console.log(`\x1b[1mHeadline\x1b[0m  ${dashboard.insight.narrative.title}`);
  console.log(`\x1b[1mSummary\x1b[0m   ${dashboard.insight.narrative.summary}`);
  console.log(`\x1b[1mTop driver\x1b[0m ${top ? `${top.label} · ${top.contributionPercent}% · ${top.rankExplanation}` : 'none'}`);
  console.log(`\x1b[1mActions\x1b[0m    ${dashboard.insight.actions.length} visible to this persona`);
  console.log(`\x1b[1mFeedback\x1b[0m  ${getFeedbackSummary(feedback).total} events · ranking updates stay in memory\n`);
  if (dashboard.insight.clarification) console.log(`\x1b[33mClarify:\x1b[0m ${dashboard.insight.clarification}\n`);
  if (dashboard.scenario.contradictions?.length) console.log(`\x1b[31mContradictions:\x1b[0m ${dashboard.scenario.contradictions.map((item) => item.label).join(' · ')}\n`);
  console.log('\x1b[1m[1]\x1b[0m material drop  \x1b[1m[2]\x1b[0m conflicting evidence  \x1b[1m[3]\x1b[0m new market');
  console.log('\x1b[1m[p]\x1b[0m switch persona  \x1b[1m[f]\x1b[0m confirm top driver  \x1b[1m[q]\x1b[0m quit');
}

const input = readline.createInterface({ input: process.stdin, output: process.stdout });
render();
input.on('line', (line) => {
  const command = line.trim().toLowerCase();
  if (command === 'q') {
    input.close();
    return;
  }
  if (['1', '2', '3'].includes(command)) scenarioIndex = Number(command) - 1;
  if (command === 'p') personaIndex = (personaIndex + 1) % personas.length;
  if (command === 'f') {
    const scenario = scenarios[scenarioIndex];
    const persona = getPersona(personas[personaIndex]);
    const top = buildDashboard({ scenarioId: scenario.id, personaId: persona.id, feedbackEvents: feedback }).insight.drivers[0];
    feedback.push({ id: `cli-${Date.now()}`, scenarioId: scenario.id, personaId: persona.id, label: 'confirmed-driver', driverId: top?.id, createdAt: new Date().toISOString() });
  }
  render();
});

input.on('close', () => process.exit(0));
