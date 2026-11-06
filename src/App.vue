<script setup>
import { computed, ref } from 'vue';
import { BasicNeedsGame, DIFFICULTIES } from './game.js';
import { decodeSave, encodeSave } from './save_manager.js';
import { TimeUnit } from './time_manager.js';
import LineChart from './components/LineChart.vue';
import MixBar from './components/MixBar.vue';

const game = new BasicNeedsGame();
const state = ref(game.getState());
const difficultyOptions = Object.values(DIFFICULTIES);
const showDifficultyPicker = ref(true);
const actionError = ref('');
const conversionError = ref('');
const conversionSelections = ref({});
const advanceDays = ref(1);
const bancorError = ref('');
const tradeDirection = ref('buy');
const selectedTradeGoodId = ref('components');
const tradeLots = ref('1');
const buildingSearch = ref('');
const selectedBuildingCategory = ref('all');
const resourceEntries = [
  ['water', 'Water'],
  ['food', 'Food'],
  ['energy', 'Energy'],
];
const energyMix = computed(() => {
  const { fossilShare, grossProduction } = state.value.resources.energy;
  const fossil = grossProduction > 0 ? Math.max(0, Math.min(1, fossilShare)) : 0;
  return { fossil, renewable: grossProduction > 0 ? 1 - fossil : 0 };
});
const renewableColor = '#1fed5c';
const energyMixSegments = computed(() => [
  {
    key: 'fossil',
    label: 'Fossil',
    value: energyMix.value.fossil,
    displayValue: `${Math.round(energyMix.value.fossil * 100)}%`,
    color: '#858b89',
  },
  {
    key: 'renewable',
    label: 'Renewable',
    value: energyMix.value.renewable,
    displayValue: `${Math.round(energyMix.value.renewable * 100)}%`,
    color: renewableColor,
  },
]);
const fuelEntries = [['fossilFuel', 'Fossil fuels']];
const FUEL_UNIT = 'GJ fuel';
const buildingCategories = [
  { id: 'all', label: 'All' },
  { id: 'water', label: 'Water' },
  { id: 'energy', label: 'Energy' },
  { id: 'food', label: 'Food' },
  { id: 'materials', label: 'Materials' },
];
const operationalSearch = ref('');
const filteredOperational = computed(() => {
  const search = operationalSearch.value.trim().toLowerCase();
  if (!search) return state.value.buildings;
  return state.value.buildings.filter((building) =>
    `${building.name} ${building.description ?? ''}`.toLowerCase().includes(search));
});
const filteredBuildingOptions = computed(() => {
  const search = buildingSearch.value.trim().toLowerCase();
  return state.value.buildingOptions.filter((building) => {
    const matchesCategory =
      selectedBuildingCategory.value === 'all' ||
      building.category === selectedBuildingCategory.value;
    const matchesSearch =
      !search ||
      `${building.name} ${building.description} ${building.category}`
        .toLowerCase()
        .includes(search);
    return matchesCategory && matchesSearch;
  });
});
const boostRows = computed(() => {
  const buildingsById = Object.fromEntries(
    state.value.buildingOptions.map((building) => [building.id, building]),
  );
  return state.value.buildingOptions.flatMap((source) =>
    Object.entries(source.boosts ?? {}).map(([targetId, amount]) => ({
      key: `${source.id}-${targetId}`,
      source: source.name,
      target: buildingsById[targetId]?.name ?? targetId,
      amount,
      falloff: source.boostFalloff ?? 1,
    })),
  );
});
const selectedTradeGood = computed(
  () => state.value.bancor.tradeGoods.find((good) => good.id === selectedTradeGoodId.value),
);
const currentTradeStock = computed(() => {
  const good = selectedTradeGood.value;
  if (!good) return 0;
  if (good.kind === 'resource') return state.value.resources[good.stockKey].amount;
  return state.value.materials[good.stockKey];
});
const maxTradeLots = computed(() => {
  const good = selectedTradeGood.value;
  if (!good) return 0;

  let maximum;
  if (tradeDirection.value === 'sell') {
    maximum = currentTradeStock.value / good.lotSize;
  } else {
    const affordableLots =
      Math.max(0, state.value.bancor.balance + state.value.bancor.debtLimit) /
      good.buyPrice;
    maximum = affordableLots;
    if (good.kind === 'resource') {
      const resource = state.value.resources[good.stockKey];
      maximum = Math.min(
        maximum,
        (resource.storageCapacity - resource.amount) / good.lotSize,
      );
    }
  }

  return Math.floor((maximum + 1e-8) * 100) / 100;
});
const sliderTradeLots = computed(() =>
  Math.min(
    Math.max(Number(tradeLots.value) || 0.01, 0.01),
    Math.max(0.01, maxTradeLots.value),
  ),
);
const tradePreview = computed(() => {
  void state.value;
  return game.quoteTrade(
    tradeDirection.value,
    selectedTradeGoodId.value,
    Number(tradeLots.value),
  );
});
const tradeStockAfter = computed(() => {
  if (!tradePreview.value.valid) return null;
  return currentTradeStock.value +
    (tradeDirection.value === 'buy' ? tradePreview.value.quantity : -tradePreview.value.quantity);
});
const saveMessage = ref('');
const saveError = ref('');
const loadInput = ref(null);
const workspaceTab = ref('infrastructure');

function saveGame() {
  saveError.value = '';
  const bytes = encodeSave(game.serialize());
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `old-adam-day-${game.elapsedDays}.oasave`;
  link.click();
  URL.revokeObjectURL(url);
  saveMessage.value = `Saved day ${game.elapsedDays}.`;
}

async function loadGame(event) {
  const [file] = event.target.files;
  event.target.value = '';
  if (!file) return;
  saveMessage.value = '';
  saveError.value = '';
  try {
    game.restore(decodeSave(await file.arrayBuffer()));
    buildQueue.value = {};
    refresh();
    saveMessage.value = `Loaded ${file.name}.`;
    showDifficultyPicker.value = false;
  } catch (error) {
    saveError.value = error.message;
  }
}

function startNewGame(difficultyId) {
  game.reset(difficultyId);
  buildQueue.value = {};
  actionError.value = '';
  conversionError.value = '';
  conversionSelections.value = {};
  bancorError.value = '';
  saveMessage.value = '';
  saveError.value = '';
  workspaceTab.value = 'dashboard';
  showDifficultyPicker.value = false;
  refresh();
}

function formatPopulation(value) {
  return value >= 1000000 ? `${value / 1000000}m` : `${value / 1000}k`;
}

function formatMinesRule(mines) {
  if (mines === 'infinite') return 'Material mines never run out';
  if (mines === 'finite') return 'Material mines are finite';
  return 'Material mining banned';
}

function formatBirthRate(rate) {
  // Display only: annual birth rate scaled over a ~30-year fertile span and a ~10% share of the population being women of that age.
  return `Birth rate ${(rate * 360 * 300).toFixed(1)} births per woman`;
}

function refresh() {
  state.value = game.getState();
}

function advance(days) {
  actionError.value = '';
  game.advance(TimeUnit.DAY, days);
  refresh();
}

function setConversionTarget(buildingIndex, event) {
  conversionSelections.value[buildingIndex] = event.target.value;
}

function canAffordConversion(targetId) {
  const option = state.value.plantConversionOptions.find(
    (conversion) => conversion.buildingId === targetId,
  );
  return option && Object.entries(option.cost).every(
    ([material, amount]) => state.value.materials[material] >= amount,
  );
}

function conversionOptionFor(building) {
  const targetId = conversionSelections.value[building.buildingIndex];
  return state.value.plantConversionOptions.find(
    (option) => option.buildingId === targetId,
  ) ?? state.value.plantConversionOptions[0];
}

function canAffordPlantConversion(building) {
  const option = conversionOptionFor(building);
  return option ? canAffordConversion(option.buildingId) : false;
}

function formatConversionCost(cost) {
  return Object.entries(cost)
    .map(([material, amount]) => `${formatRate(amount)} ${material}`)
    .join(' · ');
}

function startPlantConversion(building) {
  conversionError.value = '';
  try {
    const targetId =
      conversionSelections.value[building.buildingIndex] ??
      state.value.plantConversionOptions[0]?.buildingId;
    game.convertPlant(building.buildingIndex, targetId);
    refresh();
  } catch (error) {
    conversionError.value = error.message;
  }
}

const pendingDemolition = ref(null);

function demolishFacility(building) {
  conversionError.value = '';
  pendingDemolition.value = building;
}

const demolitionRecovery = computed(() => {
  const building = pendingDemolition.value;
  if (!building) return [];
  return Object.entries(building.cost)
    .filter(([, amount]) => amount > 0)
    .map(([material, amount]) => `${formatRate(amount * state.value.demolitionSalvage)} ${material}`);
});

function confirmDemolition() {
  const building = pendingDemolition.value;
  pendingDemolition.value = null;
  if (!building) return;
  try {
    game.demolish(building.buildingIndex);
    refresh();
  } catch (error) {
    conversionError.value = error.message;
  }
}

function updateRation(resource, event) {
  game.setRation(resource, event.target.value);
  refresh();
}

function executeTrade() {
  bancorError.value = '';
  try {
    game.trade(tradeDirection.value, selectedTradeGoodId.value, Number(tradeLots.value));
    refresh();
  } catch (error) {
    bancorError.value = error.message;
  }
}

function updateTradeLots(event) {
  tradeLots.value = event.target.value;
}

const buildQueue = ref({});
const queuedLines = computed(() =>
  state.value.buildingOptions
    .filter((building) => buildQueue.value[building.id] > 0)
    .map((building) => ({ building, count: buildQueue.value[building.id] })),
);
const queuedTotal = computed(() => queuedLines.value.reduce((sum, line) => sum + line.count, 0));
const queuedCost = computed(() => {
  const totals = { steel: 0, silicon: 0, components: 0 };
  for (const { building, count } of queuedLines.value) {
    for (const [material, amount] of Object.entries(building.cost)) totals[material] += amount * count;
  }
  return totals;
});
const catalogMaterialBalances = computed(() =>
  materialEntries.map(([key, label]) => ({
    key,
    label,
    available: state.value.materials[key],
    afterBuildList: state.value.materials[key] - (queuedCost.value[key] ?? 0),
  })),
);
// Daily gains from the whole list; recycling is capacity, converted to usable output by each material's yield.
const queuedGains = computed(() => {
  const gains = [];
  const add = (label, amount, unit) => {
    const existing = gains.find((gain) => gain.label === label);
    if (existing) existing.amount += amount;
    else gains.push({ label, amount, unit });
  };
  for (const { building, count } of queuedLines.value) {
    const boost = state.value.boostFactors[building.id] ?? 1;
    for (const [resource, amount] of Object.entries(building.production || {})) {
      add(state.value.resources[resource].label, amount * boost * count, state.value.resources[resource].unit);
    }
    for (const [material, amount] of Object.entries(building.mining || {})) {
      add(`Virgin ${material}`, amount * boost * count, material === 'fossilFuel' ? FUEL_UNIT : 'units');
    }
    for (const [material, amount] of Object.entries(building.recycling || {})) {
      add(`Recycled ${material}`, amount * boost * count * state.value.recyclingYield[material], 'units');
    }
  }
  return gains;
});
const queuedEnergyUse = computed(() =>
  queuedLines.value.reduce((sum, { building, count }) => sum + building.energyUse * count, 0),
);
const queueAffordable = computed(() =>
  Object.entries(queuedCost.value).every(([material, amount]) => state.value.materials[material] >= amount),
);

function queuedCount(buildingId) {
  return buildQueue.value[buildingId] || 0;
}

// The most of this facility the list can hold, given materials not already claimed by other items.
function maxQueueable(building) {
  const own = queuedCount(building.id);
  let max = building.siteRemaining ?? Infinity;
  for (const [material, amount] of Object.entries(building.cost)) {
    if (amount <= 0) continue;
    const spare = state.value.materials[material] - queuedCost.value[material] + own * amount;
    max = Math.min(max, Math.floor(spare / amount + 1e-9));
  }
  return Number.isFinite(max) ? Math.max(0, max) : 0;
}

function setQueued(building, event) {
  const requested = Math.floor(Number(event.target.value) || 0);
  const count = Math.min(Math.max(requested, 0), maxQueueable(building));
  const next = { ...buildQueue.value };
  if (count > 0) next[building.id] = count;
  else delete next[building.id];
  buildQueue.value = next;
  event.target.value = count;
}

function clearQueue() {
  buildQueue.value = {};
}

function buildQueued() {
  actionError.value = '';
  try {
    game.buildBatch(buildQueue.value);
    buildQueue.value = {};
    refresh();
  } catch (error) {
    actionError.value = error.message;
  }
}

function formatAmount(value) {
  if (!Number.isFinite(value)) return '—';
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(value);
}

function formatRate(value) {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value);
}

function materialMixSegments(key) {
  const inGround = state.value.virginRemaining[key];
  return [
    {
      key: 'in-ground',
      label: 'In ground',
      value: inGround,
      displayValue: Number.isFinite(inGround) ? formatRate(inGround) : 'Unlimited',
      color: '#858b89',
    },
    {
      key: 'used-up',
      label: 'Used up',
      value: state.value.usedUp[key],
      displayValue: formatRate(state.value.usedUp[key]),
      color: '#d3a751',
    },
    {
      key: 'usable',
      label: 'Usable',
      value: state.value.materials[key],
      displayValue: formatRate(state.value.materials[key]),
      color: renewableColor,
    },
  ];
}

function materialMixLabel(label, key) {
  const inGround = state.value.virginRemaining[key];
  const groundLabel = Number.isFinite(inGround) ? formatRate(inGround) : 'unlimited';
  return `${label} stock: ${groundLabel} in ground, ${formatRate(state.value.usedUp[key])} used up, ${formatRate(state.value.materials[key])} usable`;
}

function formatTradeQuantity(value) {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value);
}

function formatBancor(value) {
  return new Intl.NumberFormat(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatDays(value) {
  if (!Number.isFinite(value)) return 'Self-sufficient';
  if (value < 1) return 'Less than 1 day';
  const days = Math.floor(value);
  if (days < 36) return `${days} days`;
  const years = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(days / 360);
  return `${days.toLocaleString()} days (${years} years)`;
}

function fuelRunway(fuel) {
  const burn = state.value.materialBurn[fuel] ?? 0;
  const supply = state.value.materialProduction[fuel];
  if (burn <= 0) return Infinity;
  const stock = state.value.materials[fuel];
  return supply >= burn
    ? (stock + state.value.virginRemaining[fuel]) / burn
    : stock / (burn - supply);
}

function buildingName(id) {
  return state.value.buildingOptions.find((building) => building.id === id)?.name ?? id;
}

function formatBuildingOutput(building) {
  const factor = state.value.boostFactors[building.id] ?? 1;
  const outputs = Object.entries(building.production || {}).map(([resource, amount]) => {
    const unit = state.value.resources[resource].unit;
    return `+${formatAmount(amount * factor)} ${unit} / day`;
  });
  for (const [material, amount] of Object.entries(building.mining || {})) {
    outputs.push(`+${formatRate(amount * factor)} ${material} / day mined`);
  }
  for (const [material, amount] of Object.entries(building.recycling || {})) {
    outputs.push(`recycles up to ${formatRate(amount * factor)} ${material} / day`);
  }
  if (outputs.length === 0) return 'Facility infrastructure';
  const boost = factor > 1 ? ` (boosted +${Math.round((factor - 1) * 1000) / 10}%)` : '';
  return outputs.join(' · ') + boost;
}

function formatUpkeep(maintenance) {
  const parts = Object.entries(maintenance || {})
    .filter(([, amount]) => amount > 0)
    .map(([material, amount]) => `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 3 }).format(amount)} ${material}`);
  return parts.length ? `${parts.join(' · ')} / day` : 'None';
}

function buildingCount(buildingId) {
  return state.value.buildings.filter((building) => building.id === buildingId).length;
}

function buildingEfficiency(buildingId) {
  const efficiencies = state.value.buildings
    .filter((building) => building.id === buildingId)
    .map((building) => building.efficiency);
  return efficiencies.length ? Math.min(...efficiencies) : 1;
}

const resourceView = ref('overview');
const chartMetric = ref('amount');
const chartResource = ref('all');
const chartColors = {
  water: '#65a2b1',
  food: '#bf9b51',
  energy: '#d18d43',
  fossilFuel: '#84684f',
  silicon: '#b29d72',
  steel: '#78868f',
  components: '#6e9a80',
};
const chartLabels = {
  water: 'Water',
  food: 'Food',
  energy: 'Energy',
  fossilFuel: 'Fossil fuels',
  silicon: 'Silicon',
  steel: 'Steel',
  components: 'Components',
};
const materialEntries = [
  ['silicon', 'Silicon'],
  ['steel', 'Steel'],
  ['components', 'Components'],
];
const chartZoom = ref('full');
// span: days shown (ending at the current day); step/unitDays/prefix: axis tick spacing and label.
const chartZooms = {
  day: { label: 'Daily', span: 30, step: 5, unitDays: 1, prefix: 'D' },
  week: { label: 'Weekly', span: 84, step: 7, unitDays: 7, prefix: 'W' },
  month: { label: 'Monthly', span: 360, step: 30, unitDays: 30, prefix: 'M' },
  year: { label: 'Yearly', span: 1800, step: 360, unitDays: 360, prefix: 'Y' },
  decade: { label: 'Decade', span: 3600, step: 720, unitDays: 360, prefix: 'Y' },
  full: { label: 'Full', span: null, step: 1800, unitDays: 360, prefix: 'Y' },
};
const chartDomain = computed(() => {
  const span = chartZooms[chartZoom.value].span ?? state.value.totalDays;
  const start = Math.max(0, state.value.elapsedDays - span);
  return [start, start + span];
});
const chartXTicks = computed(() => {
  const [start, end] = chartDomain.value;
  const { step, unitDays, prefix } = chartZooms[chartZoom.value];
  const ticks = [];
  for (let day = Math.ceil(start / step) * step; day <= end; day += step) {
    ticks.push({ value: day, label: `${prefix}${Math.round(day / unitDays)}` });
  }
  return ticks;
});
const chartSeries = computed(() => {
  const allKeys =
    chartResource.value === 'all'
      ? [...resourceEntries, ...materialEntries, ...fuelEntries].map(([k]) => k)
      : [chartResource.value];
  const keys =
    chartMetric.value === 'amount'
      ? allKeys.filter((key) => key !== 'energy')
      : allKeys;
  return keys.map((key) => ({
    key,
    label: chartLabels[key],
    color: chartColors[key],
    unit:
      key in state.value.resources
        ? state.value.resources[key].unit
        : key === 'fossilFuel'
          ? FUEL_UNIT
          : 'units',
    values: state.value.history[chartMetric.value][key],
  }));
});
const chartResourceEntries = computed(() =>
  chartMetric.value === 'amount'
    ? [...resourceEntries.filter(([key]) => key !== 'energy'), ...materialEntries, ...fuelEntries]
    : [...resourceEntries, ...materialEntries, ...fuelEntries],
);

function formatChartDay(day) {
  return `Year ${Math.floor(day / 360) + 1}, month ${Math.floor((day % 360) / 30) + 1}, day ${(day % 30) + 1}`;
}

function updateChartMetric(event) {
  chartMetric.value = event.target.value;
  if (chartMetric.value === 'amount' && chartResource.value === 'energy') {
    chartResource.value = 'all';
  }
}

function statusLabel(status) {
  if (status === 'survived') {
    return state.value.scores.verdict === 'guarantee-kept'
      ? 'Guarantee kept for 20 years'
      : '20 years reached, guarantee failed';
  }
  if (status === 'collapsed') return 'Civilisation collapsed';
  return 'Settlement active';
}

function formatPercent(value) {
  return `${Math.round(value * 100)}%`;
}

const verdictText = computed(() => {
  const { verdict, thresholds } = state.value.scores;
  if (verdict === 'guarantee-kept') {
    return 'Everyone was provided for. Reliable public services kept people alive, healthy and secure for 20 years.';
  }
  if (verdict === 'guarantee-failed') {
    return `The settlement lasted 20 years, but the guarantee failed. Keeping it means at least ${formatPercent(thresholds.populationKept)} of the population alive and ${formatPercent(thresholds.coverage)} of person-days fully covered.`;
  }
  if (verdict === 'collapsed') {
    return 'The public systems could not meet people\'s needs, and the settlement collapsed.';
  }
  return 'Keep everyone alive and covered. Surviving is not enough: the guarantee has to hold.';
});
</script>

<template>
  <main class="game-shell">
    <header class="global-header">
      <div class="global-header-nav">
        <a
          class="wordmark"
          href="#dashboard"
          aria-label="Old Adam home"
          @click.prevent="workspaceTab = 'dashboard'"
        >
          <span class="wordmark-icon" aria-hidden="true">OA</span>
          <span>OLD <span class="wordmark-light">ADAM</span></span>
        </a>
        <nav class="workspace-nav" aria-label="Settlement sections" role="tablist">
          <button
            v-for="tab in [
              { id: 'dashboard', label: 'Dashboard & Supplies' },
              { id: 'infrastructure', label: 'Infrastructure & Rations' },
              { id: 'bancor', label: 'Bancor Exchange' },
              { id: 'logs', label: 'Logs & Settings' },
            ]"
            :key="tab.id"
            type="button"
            role="tab"
            class="workspace-tab"
            :class="{ 'workspace-tab-active': workspaceTab === tab.id }"
            :aria-selected="workspaceTab === tab.id"
            @click="workspaceTab = tab.id"
          >{{ tab.label }}</button>
        </nav>
      </div>
    </header>

    <div class="shell-body">
    <aside class="status-sidebar" aria-label="Settlement status">
      <div class="campaign-status" :class="`status-${state.status}`">
        <span class="status-dot"></span>
        {{ statusLabel(state.status) }}
      </div>
      <div class="header-stat">
        <span class="card-label">DIFFICULTY</span>
        <strong>{{ state.difficulty.label }}</strong>
      </div>
      <div class="header-stat">
        <span class="card-label">POPULATION</span>
        <strong>{{ formatAmount(state.population) }}</strong>
      </div>
      <div class="status-stat-pair">
        <div class="header-stat">
          <span class="card-label">HEALTH</span>
          <strong>{{ Math.round(state.health * 100) }}%</strong>
        </div>
        <div class="header-stat">
          <span class="card-label">HAPPINESS</span>
          <strong>{{ Math.round(state.happiness * 100) }}%</strong>
        </div>
      </div>
      <div class="header-stat horizon-stat">
        <div class="horizon-heading">
          <span class="card-label">TIME HORIZON</span>
          <span class="date-pill">{{ state.date.formatted }}</span>
        </div>
        <strong>Year {{ Math.floor(state.elapsedDays / 360) }} / 20</strong>
        <div class="meter"><span class="time-meter" :style="{ width: `${state.progress * 100}%` }"></span></div>
      </div>
      <div class="time-controls sidebar-time-controls">
        <label class="time-slider-label" for="advance-days">
          <span>Time to advance</span>
          <strong>{{ advanceDays }} day{{ advanceDays === 1 ? '' : 's' }}</strong>
        </label>
        <input
          id="advance-days"
          v-model.number="advanceDays"
          type="range"
          min="1"
          max="30"
          step="1"
          class="advance-range"
          aria-label="Time to advance in days"
        >
        <button
          :disabled="state.status !== 'playing'"
          class="button button-primary advance-button"
          @click="advance(advanceDays)"
        >
          Advance time <span aria-hidden="true">→</span>
        </button>
      </div>
      <button
        type="button"
        class="sidebar-help-link"
        :aria-current="workspaceTab === 'help' ? 'page' : null"
        @click="workspaceTab = 'help'"
      >Help</button>
    </aside>

    <section class="workspace" role="tabpanel">
      <template v-if="workspaceTab === 'dashboard'">
        <div class="workspace-heading">
          <div>
            <p class="eyebrow">WORKSPACE: TAB 1</p>
            <h1>Dashboard &amp; Supplies</h1>
          </div>
          <span class="quiet-label">ON HAND · PRODUCED / DAY · NEEDED / DAY</span>
        </div>
        <section class="panel resource-panel">
          <div class="section-heading">
            <div>
              <p class="eyebrow">THE DAILY BALANCE</p>
              <h2>Essential resources</h2>
            </div>
          </div>
          <p class="resource-explainer">
            These are public services, not rewards people must earn. Production is added daily; need
            is what the current population consumes. Runway estimates how long stored supplies last
            if daily need exceeds production.
          </p>
          <div class="view-toggle" role="group" aria-label="Resource view">
            <button
              type="button"
              class="category-filter"
              :class="{ 'category-filter-active': resourceView === 'overview' }"
              :aria-pressed="resourceView === 'overview'"
              @click="resourceView = 'overview'"
            >Overview</button>
            <button
              type="button"
              class="category-filter"
              :class="{ 'category-filter-active': resourceView === 'graph' }"
              :aria-pressed="resourceView === 'graph'"
              @click="resourceView = 'graph'"
            >Line graph</button>
          </div>
          <div v-if="resourceView === 'graph'" class="resource-chart">
            <div class="chart-controls">
              <label>
                <span>Show</span>
                <select :value="chartMetric" @change="updateChartMetric">
                  <option value="amount">Amount stored</option>
                  <option value="production">Production rate / day</option>
                </select>
              </label>
              <label>
                <span>Resource</span>
                <select v-model="chartResource">
                  <option value="all">All resources</option>
                  <option v-for="[key, label] in chartResourceEntries" :key="key" :value="key">
                    {{ label }}
                  </option>
                </select>
              </label>
            </div>
            <div class="view-toggle" role="group" aria-label="Zoom level">
              <button
                v-for="(zoom, id) in chartZooms"
                :key="id"
                type="button"
                class="category-filter"
                :class="{ 'category-filter-active': chartZoom === id }"
                :aria-pressed="chartZoom === id"
                @click="chartZoom = id"
              >{{ zoom.label }}</button>
            </div>
            <LineChart
              v-if="chartSeries.length"
              :x="state.history.days"
              :series="chartSeries"
              :domain="chartDomain"
              :x-ticks="chartXTicks"
              :format-value="formatAmount"
              :format-x="formatChartDay"
              :value-suffix="chartMetric === 'production' ? ' / day' : ''"
              :aria-label="`${chartMetric === 'amount' ? 'Stored amount' : 'Production rate'} over time`"
            />
            <p v-else class="small-note">Select a resource with recorded stock or switch to production rate.</p>
            <p v-if="chartSeries.length > 1" class="small-note">
              Each line is scaled to its own peak so differing units can be compared; choose a
              single item to plot it on its own scale.
            </p>
          </div>
          <div v-else class="resource-list">
            <article v-for="[key, label] in resourceEntries" :key="key" class="resource-row">
              <div class="resource-name">
                <span class="resource-icon" :class="`icon-${key}`" aria-hidden="true">
                  {{ key === 'water' ? 'W' : key === 'food' ? 'F' : 'E' }}
                </span>
                <div><strong>{{ label }}</strong><span>{{ state.resources[key].unit }}</span></div>
              </div>
              <div class="resource-details">
                <template v-if="key === 'energy'">
                  <div class="resource-amount"><strong>Generation</strong><span>grid supply</span></div>
                  <MixBar
                    title="Generation mix"
                    :segments="energyMixSegments"
                    :aria-label="`Energy generation mix: ${Math.round(energyMix.fossil * 100)}% fossil fuels, ${Math.round(energyMix.renewable * 100)}% renewables`"
                  />
                  <div class="resource-flow">
                    <span><b>{{ formatAmount(state.resources[key].dailyProduction) }}</b> net available / day ({{ formatAmount(state.resources[key].facilityUse) }} used by facilities)</span>
                    <span><b>{{ Math.round(state.resources[key].fossilShare * 100) }}%</b> from fossil fuels ({{ formatAmount(state.resources[key].fossilProduction) }} of {{ formatAmount(state.resources[key].grossProduction) }} generated / day)</span>
                    <span><b>{{ formatAmount(state.resources[key].dailyNeed) }}</b> needed / day</span>
                    <span class="runway">{{ state.resources[key].dailyProduction >=  state.resources[key].dailyNeed ? 'Daily demand met' : 'Generation shortfall' }}</span>
                  </div>
                </template>
                <template v-else>
                  <div class="resource-amount">
                    <strong>{{ formatAmount(state.resources[key].amount) }}</strong><span>stored</span>
                  </div>
                  <div class="resource-meter">
                    <div class="meter"><span :class="`resource-meter-${key}`" :style="{ width: `${state.resources[key].fill * 100}%` }"></span></div>
                    <span>{{ Math.round(state.resources[key].fill * 100) }}% capacity</span>
                  </div>
                  <div class="resource-flow">
                    <span><b>{{ state.resources[key].dailyProduction < 0 ? '−' : '+' }}{{ formatAmount(Math.abs(state.resources[key].dailyProduction)) }}</b> / day</span>
                    <span><b>{{ formatAmount(state.resources[key].dailyNeed) }}</b> needed / day</span>
                    <span class="runway">{{ formatDays(state.resources[key].daysRemaining) }}</span>
                  </div>
                </template>
              </div>
            </article>
            <article v-for="[key, label] in fuelEntries" :key="key" class="resource-row">
              <div class="resource-name">
                <span class="resource-icon material-icon" aria-hidden="true">F</span>
                <div><strong>{{ label }}</strong><span>{{ FUEL_UNIT }}</span></div>
              </div>
              <div class="resource-details material-details">
                <MixBar
                  title="Stock breakdown"
                  :segments="materialMixSegments(key)"
                  :aria-label="materialMixLabel(label, key)"
                />
                <div class="resource-flow">
                  <span><b>{{ formatAmount(state.materialBurn[key] ?? 0) }}</b> burned / day</span>
                  <span><b>{{ formatAmount(state.materialProduction[key]) }}</b> extracted / day</span>
                  <span v-if="state.materials[key] <= 0 && state.virginRemaining[key] <= 0" class="runway">Depleted</span>
                  <span v-else class="runway">{{ formatDays(fuelRunway(key)) }} estimated runway</span>
                </div>
              </div>
            </article>
            <article v-for="[key, label] in materialEntries" :key="key" class="resource-row">
              <div class="resource-name">
                <span class="resource-icon material-icon"><span class="material-mark" :class="`mark-${key}`"></span></span>
                <div><strong>{{ label }}</strong><span>units</span></div>
              </div>
              <div class="resource-details material-details">
                <MixBar
                  title="Stock breakdown"
                  :segments="materialMixSegments(key)"
                  :aria-label="materialMixLabel(label, key)"
                />
                <div class="resource-flow">
                  <span><b>+{{ formatRate(state.materialProduction[key]) }}</b> / day</span>
                  <span><b>{{ formatRate(state.materialUpkeep[key]) }}</b> upkeep / day</span>
                </div>
              </div>
            </article>
            <p v-if="!state.maintenanceOperational" class="maintenance-warning" role="status">
              Some facility upkeep is underfunded. Efficiency declines gradually and recovers as
              maintenance materials become available. Lowest facility efficiency:
              {{ Math.round(state.lowestFacilityEfficiency * 100) }}%.
            </p>
            <p class="small-note">
              Materials are spent on construction and daily maintenance. Worn-out maintenance
              materials go to the used-up pile; recyclers turn it back into usable stock, but some
              is lost each cycle (steel {{ Math.round(state.recyclingYield.steel * 100) }}%, silicon
              {{ Math.round(state.recyclingYield.silicon * 100) }}%, components
              {{ Math.round(state.recyclingYield.components * 100) }}% recovered). Lost material can only be replaced by mining or Bancor trade.
              <template v-if="state.difficulty.mines === 'infinite'">               Mines supply daily deliveries and never run dry.</template>
                            <template v-else-if="state.difficulty.mines === 'finite'"> Mines supply daily deliveries, but the ground's reserves are finite.</template>
              <template v-else> Mining is banned: new materials only come from recycling and Bancor trade.</template>
            </p>
          </div>
        </section>
        <section class="panel service-record-panel" aria-live="polite">
          <div class="section-heading">
            <div>
              <p class="eyebrow">THE PUBLIC GUARANTEE</p>
              <h2>Universal service record</h2>
            </div>
            <strong v-if="state.serviceRecord.daysTracked > 0" class="service-record-score">
              {{ formatAmount(state.serviceRecord.daysFullyCovered) }} / {{ formatAmount(state.serviceRecord.daysTracked) }} days
            </strong>
          </div>
          <p class="panel-copy">
            A day counts as fully covered only when available water, food, and energy meet everyone's
            baseline needs. Universal services are essential infrastructure: they support the health
            and wellbeing of the whole country.
          </p>
          <p v-if="state.serviceRecord.daysTracked === 0" class="small-note">
            {{ state.elapsedDays === 0
              ? 'The public service record begins on your first day.'
              : 'This older save has no service record. Tracking begins from the loaded day.' }}
          </p>
          <template v-else>
            <p class="service-outcome">{{ verdictText }}</p>
            <div class="score-grid">
              <div class="score-card">
                <span class="card-label">POPULATION KEPT</span>
                <strong>{{ formatPercent(state.scores.populationKept) }}</strong>
              </div>
              <div class="score-card">
                <span class="card-label">NEEDS COVERED</span>
                <strong>{{ formatPercent(state.scores.coverage) }}</strong>
                <small>of the starting population, per day</small>
              </div>
              <div class="score-card">
                <span class="card-label">LIVES LOST</span>
                <strong>{{ formatAmount(state.scores.deaths) }}</strong>
              </div>
              <div class="score-card">
                <span class="card-label">AVERAGE HAPPINESS</span>
                <strong>{{ formatPercent(state.scores.meanHappiness) }}</strong>
              </div>
              <div class="score-card">
                <span class="card-label">STABILITY</span>
                <strong>{{ formatPercent(state.scores.stability) }}</strong>
                <small>builds while needs are met</small>
              </div>
            </div>
            <p class="small-note">
              Stability grows each day the guarantee holds and drops sharply when it fails. Higher
              stability speeds health recovery and raises the birth rate: reliable services make the
              whole country stronger.
            </p>
            <div class="service-shortfall-list">
              <span>Fully covered days: <strong>{{ formatAmount(state.serviceRecord.daysFullyCovered) }} / {{ formatAmount(state.serviceRecord.daysTracked) }}</strong></span>
              <span>Days with any service shortfall: <strong>{{ formatAmount(state.serviceRecord.shortfallDays.all) }}</strong></span>
              <span v-for="[key, label] in resourceEntries" :key="key">
                {{ label }} shortfall days: <strong>{{ formatAmount(state.serviceRecord.shortfallDays[key]) }}</strong>
              </span>
            </div>
          </template>
        </section>
      </template>

      <template v-else-if="workspaceTab === 'infrastructure'">
        <div class="workspace-heading">
          <div>
            <p class="eyebrow">WORKSPACE: TAB 2 — INFRASTRUCTURE &amp; RATIONS</p>
            <h1>Build capacity for the future</h1>
          </div>
        </div>
        <div class="facility-filters">
          <label class="building-search-label" for="building-search">Search facilities</label>
          <input
            id="building-search"
            v-model="buildingSearch"
            class="building-search"
            type="search"
            placeholder="Search by name or description"
          >
          <div class="category-filters" aria-label="Filter facilities by category">
            <button
              v-for="category in buildingCategories"
              :key="category.id"
              type="button"
              class="category-filter"
              :class="{ 'category-filter-active': selectedBuildingCategory === category.id }"
              :aria-pressed="selectedBuildingCategory === category.id"
              @click="selectedBuildingCategory = category.id"
            >{{ category.label }}</button>
          </div>
        </div>
        <div class="infrastructure-workspace">
          <div class="operations-column">
          <section class="panel operations-panel" aria-labelledby="operations-heading">
            <div class="section-heading">
              <div>
                <p class="eyebrow">ACTIVE OPERATIONS</p>
                <h2 id="operations-heading">In progress &amp; operational</h2>
              </div>
            </div>
            <div class="operations-scroll">
              <section class="operations-group">
                <h3 class="infrastructure-column-heading">Under construction ({{ state.construction.length }})</h3>
                <article v-for="project in state.construction" :key="project.id" class="project-card">
                  <div class="project-topline"><span>{{ project.category }}</span><strong>{{ project.daysRemaining }}d left</strong></div>
                  <strong class="project-name">{{ project.name }}</strong>
                  <div class="meter">
                    <span class="project-meter" :style="{ width: `${((project.totalDays - project.daysRemaining) / project.totalDays) * 100}%` }"></span>
                  </div>
                </article>
                <p v-if="state.construction.length === 0" class="small-note">No facilities under construction.</p>
              </section>
              <section class="operations-group">
                <h3 class="infrastructure-column-heading">Operational facilities ({{ state.buildings.length }})</h3>
                <input
                  v-if="state.buildings.length"
                  v-model="operationalSearch"
                  class="building-search"
                  type="search"
                  placeholder="Search built facilities"
                  aria-label="Search built facilities"
                >
                <p v-if="state.buildings.length && filteredOperational.length === 0" class="small-note">No built facilities match your search.</p>
                <ul v-if="filteredOperational.length" class="operational-list">
                  <li v-for="building in filteredOperational" :key="building.buildingIndex">
                    <span>
                      {{ building.name }}
                      <small class="upkeep-line">Upkeep: {{ formatUpkeep(building.maintenance) }}</small>
                      <small class="upkeep-line">Energy use: {{ formatAmount(building.energyUse * building.efficiency) }} kWh / day</small>
                      <small v-for="(amount, fuel) in building.fuelUse" :key="fuel" class="upkeep-line">
                        Uses {{ formatAmount(amount * building.efficiency) }} {{ FUEL_UNIT }} / day
                      </small>
                      <div
                        v-if="['coalPowerPlant', 'naturalGasPowerPlant'].includes(building.id)"
                        class="conversion-control"
                      >
                        <label :for="`conversion-${building.buildingIndex}`">Convert plant to</label>
                        <select
                          :id="`conversion-${building.buildingIndex}`"
                          :value="conversionOptionFor(building).buildingId"
                          :disabled="building.conversionInProgress || building.demolitionInProgress || state.status !== 'playing'"
                          @change="setConversionTarget(building.buildingIndex, $event)"
                        >
                          <option
                            v-for="option in state.plantConversionOptions"
                            :key="option.buildingId"
                            :value="option.buildingId"
                          >{{ option.name }}</option>
                        </select>
                        <small class="upkeep-line">
                          {{ formatConversionCost(conversionOptionFor(building).cost) }}
                          · {{ conversionOptionFor(building).days }} days
                        </small>
                        <button
                          type="button"
                          class="button button-secondary"
                          :disabled="building.conversionInProgress || building.demolitionInProgress || state.status !== 'playing' || !canAffordPlantConversion(building)"
                          @click="startPlantConversion(building)"
                        >{{ building.conversionInProgress ? 'Conversion in progress' : 'Start conversion' }}</button>
                      </div>
                      <button
                        type="button"
                        class="button button-secondary"
                        :disabled="building.conversionInProgress || building.demolitionInProgress || state.status !== 'playing'"
                        @click="demolishFacility(building)"
                      >{{ building.demolitionInProgress ? 'Demolition in progress' : `Demolish (${building.demolishDays} days)` }}</button>
                    </span>
                    <strong>{{ Math.round(building.efficiency * 100) }}% efficiency</strong>
                  </li>
                </ul>
                <p v-if="conversionError" class="action-error" role="alert">{{ conversionError }}</p>
                <p v-if="state.buildings.length" class="energy-total">Total facility energy use: <strong>{{ formatAmount(state.resources.energy.facilityUse) }} kWh / day</strong></p>
                <p v-else class="small-note">Completed facilities will appear here.</p>
                <p v-if="!state.maintenanceOperational" class="maintenance-warning" role="status">
                  Maintenance is underfunded. Facility efficiency will decline until upkeep can be paid.
                </p>
              </section>
            </div>
          </section>

          <section class="panel ration-panel" aria-labelledby="ration-heading">
            <div class="section-heading">
              <div>
                <p class="eyebrow">RATIONS</p>
                <h2 id="ration-heading">Ration controls</h2>
              </div>
            </div>
            <div class="operations-scroll ration-scroll">
              <section class="operations-group ration-group">
                <p class="panel-copy">
                  Recommended amounts meet basic needs. Higher water and food rations use more
                  stock; higher electricity rations require more grid generation.
                </p>
                <div v-for="resource in ['water', 'food', 'energy']" :key="resource" class="ration-control">
                  <div class="ration-heading">
                    <label :for="`${resource}-ration`">{{ state.resources[resource].label }}</label>
                    <strong>{{ Number(state.resources[resource].rationPerPerson).toFixed(resource === 'water' ? 0 : 1) }} {{ state.resources[resource].unit }}<span> / day</span></strong>
                  </div>
                  <input
                    :id="`${resource}-ration`"
                    type="range"
                    :min="state.resources[resource].dailyNeedPerPerson"
                    :max="state.resources[resource].maxRationPerPerson"
                    :step="resource === 'water' ? 1 : resource === 'food' ? 25 : 0.1"
                    :value="state.resources[resource].rationPerPerson"
                    :aria-label="`${state.resources[resource].label} ration per person per day`"
                    @input="updateRation(resource, $event)"
                  >
                  <div class="ration-scale">
                    <span>Min {{ formatAmount(state.resources[resource].dailyNeedPerPerson) }} {{ state.resources[resource].unit }}</span>
                    <span>Max {{ formatAmount(state.resources[resource].maxRationPerPerson) }}</span>
                  </div>
                </div>
              </section>
            </div>
          </section>
          </div>

          <section class="panel catalog-panel" aria-labelledby="catalog-heading">
            <div class="catalog-materials" aria-label="Usable construction materials now and after the build list">
              <span class="catalog-materials-heading">Usable materials <small>current / after build list</small></span>
              <span
                v-for="material in catalogMaterialBalances"
                :key="material.key"
                class="catalog-material-balance"
                :class="{ 'catalog-material-short': material.afterBuildList < 0 }"
              >
                <strong>{{ material.label }}</strong>
                <span class="catalog-material-fraction">
                  {{ formatRate(material.available) }} <i>/</i> {{ formatRate(material.afterBuildList) }}
                </span>
              </span>
            </div>
            <div class="section-heading">
              <div>
                <p class="eyebrow">BUILD CATALOG</p>
                <h2 id="catalog-heading">Facilities to build</h2>
              </div>
            </div>
            <div class="building-list catalog-scroll">
              <article v-for="building in filteredBuildingOptions" :key="building.id" class="building-card">
                <div class="building-title">
                  <div>
                    <h3>{{ building.name }}</h3>
                    <span class="category-badge">{{ building.category }}</span>
                    <span v-if="building.siteLimit !== null" class="built-count">
                      BUILT {{ buildingCount(building.id) }}/{{ building.siteLimit }}
                    </span>
                    <span v-else-if="buildingCount(building.id)" class="built-count">
                      BUILT ×{{ buildingCount(building.id) }}
                    </span>
                    <span v-if="buildingCount(building.id)" class="facility-efficiency">
                      Lowest efficiency: {{ Math.round(buildingEfficiency(building.id) * 100) }}%
                    </span>
                  </div>
                  <span class="build-time">{{ building.buildDays }} days</span>
                </div>
                <p>{{ building.description }}</p>
                <span class="building-output">{{ formatBuildingOutput(building) }}</span>
                <div class="cost-row">
                  <span v-for="(amount, material) in building.cost" :key="material" :class="{ 'cost-missing': state.materials[material] < amount }">
                    {{ material }}: {{ amount }} needed · {{ formatRate(state.materials[material]) }} available
                  </span>
                </div>
                <span class="upkeep-line">Upkeep: {{ formatUpkeep(building.maintenance) }}</span>
                <span class="upkeep-line">Energy use: {{ formatAmount(building.energyUse) }} kWh / day</span>
                <span v-for="(amount, fuel) in building.fuelUse" :key="fuel" class="upkeep-line">
                  Uses {{ formatAmount(amount) }} {{ FUEL_UNIT }} / day
                </span>
                <span v-if="building.siteLimit !== null" class="upkeep-line">
                  Suitable sites: {{ building.siteRemaining }} of {{ building.siteLimit }} left
                </span>
                <span v-if="building.seasonality" class="upkeep-line">
                  Output now: {{ Math.round((state.outputFactors[building.id] ?? 1) * 100) }}% of average{{ state.droughtYear ? ' (drought year)' : '' }}
                </span>
                <span v-for="(amount, target) in building.boosts" :key="`boost-${target}`" class="upkeep-line">
                  Boosts each {{ buildingName(target) }} by +{{ Math.round(amount * 100) }}%
                </span>
                <span v-for="(amount, resource) in building.storageBonus" :key="resource" class="upkeep-line">
                  Adds {{ formatAmount(amount) }} {{ resource }} storage
                </span>
                <div class="queue-control">
                  <label :for="`queue-${building.id}`">
                    <span>{{ building.locked ? (building.siteRemaining === 0 ? 'No sites left' : 'Mining banned') : 'Quantity to build' }}</span>
                    <strong>{{ queuedCount(building.id) }} / {{ maxQueueable(building) }}</strong>
                  </label>
                  <input
                    :id="`queue-${building.id}`"
                    type="range"
                    min="0"
                    :max="Math.max(1, maxQueueable(building))"
                    step="1"
                    :value="queuedCount(building.id)"
                    :disabled="state.status !== 'playing' || !!building.locked || maxQueueable(building) === 0"
                    :aria-label="`Number of ${building.name} to build`"
                    @input="setQueued(building, $event)"
                  >
                  <small v-if="!building.locked && maxQueueable(building) === 0 && queuedCount(building.id) === 0">Need more materials</small>
                </div>
              </article>
              <p v-if="filteredBuildingOptions.length === 0" class="small-note">
                No facilities match your search and selected category.
              </p>
            </div>
            <div class="build-cart" aria-labelledby="cart-heading">
              <h3 id="cart-heading" class="infrastructure-column-heading">Build list ({{ queuedTotal }})</h3>
              <ul v-if="queuedLines.length" class="cart-lines">
                <li v-for="line in queuedLines" :key="line.building.id">
                  <span>{{ line.count }}× {{ line.building.name }}</span>
                  <button type="button" class="cart-remove" :aria-label="`Remove ${line.building.name}`" @click="setQueued(line.building, { target: { value: 0 } })">✕</button>
                </li>
              </ul>
              <p v-else class="small-note">Use the sliders to add facilities. Nothing is spent until you confirm.</p>
              <div v-if="queuedGains.length" class="cost-row gain-row" aria-label="Daily productivity gained">
                <span v-for="gain in queuedGains" :key="gain.label">
                  +{{ formatRate(gain.amount) }} {{ gain.unit === 'units' ? '' : `${gain.unit} ` }}{{ gain.label }} / day
                </span>
              </div>
              <p v-if="queuedLines.length" class="energy-total">Added energy use: <strong>{{ formatAmount(queuedEnergyUse) }} kWh / day</strong></p>
              <div class="cost-row">
                <span v-for="(amount, material) in queuedCost" :key="material" :class="{ 'cost-missing': state.materials[material] < amount }">
                  {{ material }}: {{ formatRate(amount) }} of {{ formatRate(state.materials[material]) }} available
                </span>
              </div>
              <div class="cart-actions">
                <button
                  type="button"
                  class="button button-primary"
                  :disabled="state.status !== 'playing' || queuedTotal === 0 || !queueAffordable"
                  @click="buildQueued"
                ><span>{{ queueAffordable ? `Build ${queuedTotal} ${queuedTotal === 1 ? 'facility' : 'facilities'}` : 'Need more materials' }}</span><span aria-hidden="true">→</span></button>
                <button type="button" class="button button-secondary" :disabled="queuedTotal === 0" @click="clearQueue"><span>Clear</span></button>
              </div>
            </div>
          </section>
        </div>
        <p v-if="actionError" class="action-error" role="alert">{{ actionError }}</p>
      </template>

      <template v-else-if="workspaceTab === 'bancor'">
        <div class="workspace-heading">
          <div><p class="eyebrow">WORKSPACE: TAB 3</p><h1>Bancor Exchange</h1></div>
          <span class="bancor-balance" :class="{ 'bancor-negative': state.bancor.balance < 0 }">
            {{ formatBancor(state.bancor.balance) }} B
          </span>
        </div>
        <section class="panel bancor-panel">
          <div class="section-heading">
            <div><p class="eyebrow">LAST-RESORT EXCHANGE</p><h2>Buy or sell supplies</h2></div>
          </div>
          <p class="panel-copy">
            Sell surplus water, food, fossil fuels, or materials for Bancor, or buy them when
            short. Purchases can use limited credit; trade prices include a buy/sell spread.
          </p>
          <form class="trade-form" @submit.prevent="executeTrade">
            <div class="trade-fields">
              <label><span>Action</span><select v-model="tradeDirection"><option value="buy">Buy</option><option value="sell">Sell</option></select></label>
              <label>
                <span>Good</span>
                <select v-model="selectedTradeGoodId">
                  <option v-for="good in state.bancor.tradeGoods" :key="good.id" :value="good.id">
                    {{ good.label }} ({{ good.lotLabel }})
                  </option>
                </select>
              </label>
              <label>
                <span>Lots (enter any amount)</span>
                <input
                  :value="tradeLots"
                  type="text"
                  inputmode="decimal"
                  autocomplete="off"
                  aria-label="Trade amount in lots"
                  @input="updateTradeLots"
                >
              </label>
            </div>
            <label class="trade-slider-label" for="trade-lots-slider">
              <span>Adjust trade amount</span>
              <strong>{{ formatTradeQuantity(sliderTradeLots) }} lots</strong>
            </label>
            <input
              id="trade-lots-slider"
              class="trade-range"
              type="range"
              min="0.01"
              :max="Math.max(0.01, maxTradeLots)"
              step="0.01"
              :value="sliderTradeLots"
              :disabled="maxTradeLots < 0.01"
              aria-label="Adjust trade amount in lots"
              @input="updateTradeLots"
            >
            <div class="trade-quote" aria-live="polite">
              <span>Current stock: <strong>{{ formatTradeQuantity(currentTradeStock) }} {{ selectedTradeGood?.unit }}</strong></span>
              <template v-if="tradePreview.valid">
                <span>{{ tradeDirection === 'buy' ? 'Cost' : 'You receive' }}: <strong>{{ formatBancor(tradePreview.total) }} B</strong></span>
                <span>Balance after trade: <strong :class="{ 'bancor-negative': tradePreview.balanceAfter < 0 }">{{ formatBancor(tradePreview.balanceAfter) }} B</strong></span>
                <span>Stock after trade: <strong>{{ formatTradeQuantity(tradeStockAfter) }} {{ selectedTradeGood.unit }}</strong></span>
                <span>Rate: {{ formatBancor(tradePreview.unitPrice) }} B / {{ selectedTradeGood.lotLabel }}</span>
              </template>
              <span v-else class="trade-error">{{ tradePreview.error }}</span>
            </div>
            <button class="button button-primary trade-button" type="submit" :disabled="state.status !== 'playing' || !tradePreview.valid">
              {{ tradeDirection === 'buy' ? 'Buy supplies' : 'Sell surplus' }}
            </button>
            <p v-if="bancorError" class="action-error" role="alert">{{ bancorError }}</p>
          </form>
          <div class="bancor-terms">
            <span>Credit limit: {{ formatBancor(state.bancor.debtLimit) }} B</span>
            <span v-for="tier in state.bancor.feeTiers" :key="tier.threshold">
              Clearing charge: {{ (tier.annualRate * 100).toFixed(0) }}% a year on balances (credit or debit) beyond {{ formatBancor(tier.threshold) }} B
            </span>
            <span v-if="state.bancor.nextDailyFee > 0" class="fee-warning">Next daily charge: {{ state.bancor.nextDailyFee.toFixed(3) }} B</span>
          </div>
        </section>
      </template>

      <template v-else-if="workspaceTab === 'logs'">
        <div class="workspace-heading">
          <div><p class="eyebrow">WORKSPACE: TAB 4</p><h1>Logs &amp; Settings</h1></div>
        </div>
        <div class="settings-grid">
          <section class="panel activity-panel">
            <div class="section-heading"><div><p class="eyebrow">SETTLEMENT RECORD</p><h2>Recent activity</h2></div></div>
            <div v-if="state.events.length" class="event-list">
              <div v-for="event in state.events" :key="event.id" class="event-row">
                <span class="event-day">DAY {{ formatAmount(event.day) }}</span><span>{{ event.message }}</span>
              </div>
            </div>
            <p v-else class="small-note">Your first turn will appear here.</p>
          </section>
          <section class="panel save-panel">
            <div class="section-heading"><div><p class="eyebrow">KEEP YOUR PROGRESS</p><h2>Save &amp; load</h2></div></div>
            <p class="panel-copy">Download your settlement as a binary save file, or load one back in.</p>
            <div class="turn-buttons">
              <button type="button" class="button button-primary" @click="saveGame"><span>Save game</span><span aria-hidden="true">↓</span></button>
              <button type="button" class="button button-secondary" @click="loadInput.click()"><span>Load game</span><span aria-hidden="true">↑</span></button>
              <button type="button" class="button button-secondary" @click="showDifficultyPicker = true"><span>New game</span><span aria-hidden="true">+</span></button>
            </div>
            <p v-if="saveMessage" class="ration-extra" role="status">{{ saveMessage }}</p>
            <p v-if="saveError" class="action-error" role="alert">{{ saveError }}</p>
          </section>
        </div>
      </template>

      <template v-else>
        <div class="workspace-heading">
          <div><p class="eyebrow">SETTLEMENT GUIDE</p><h1>How to keep the settlement going</h1></div>
        </div>
        <div class="help-grid">
          <section class="panel help-card">
            <p class="eyebrow">THE OBJECTIVE</p>
            <h2>Survive and keep the guarantee</h2>
            <p>
              Advance through 20 years while keeping the population alive and providing reliable
              water, food, and electricity. Collapse occurs if population or health reaches zero. To
              keep the service guarantee at year 20, at least 90% of the starting population must
              remain and at least 95% of tracked days must meet all three basic needs.
            </p>
          </section>
          <section class="panel help-card">
            <p class="eyebrow">EACH DAY</p>
            <h2>Needs, health, and happiness</h2>
            <p>
              Each day, production and consumption are resolved, facilities are maintained,
              population and health are updated, and the calendar advances. Baseline needs per
              person are currently {{ formatRate(state.resources.water.dailyNeedPerPerson) }}
              {{ state.resources.water.unit }} of water,
              {{ formatRate(state.resources.food.dailyNeedPerPerson) }} {{ state.resources.food.unit }}
              of food, and {{ formatRate(state.resources.energy.dailyNeedPerPerson) }}
              {{ state.resources.energy.unit }} of energy per day. Shortages damage health;
              water shortages have the strongest effect. Below 50% health, deaths rise
              exponentially. Meeting needs supports happiness and stability, while higher rations
              use more stock and can improve happiness.
            </p>
          </section>
          <section class="panel help-card">
            <p class="eyebrow">BUILD CAPACITY</p>
            <h2>Projects and resources</h2>
            <p>
              Your settlement begins with some prebuilt facilities, but their output does not
              cover everyone's baseline needs. Build more facilities to increase water, food,
              energy, or material production. A
              project's materials are spent when construction starts, and its build time runs
              while other projects can progress in parallel. Use the quantity sliders to build a
              list (each slider is limited by the materials left after your other choices), then
              confirm everything with a single build button. Resource
              storage is limited; the dashboard shows stock, daily flows, and estimated days
              remaining.
            </p>
          </section>
          <section class="panel help-card">
            <p class="eyebrow">MATERIALS</p>
            <h2>Maintain and recycle</h2>
            <p>
              Materials are consumed by construction and facility maintenance. Maintenance
              materials move into the used-up stock; recyclers recover part of that stock back
              into usable materials. Facilities lose efficiency when upkeep is underfunded.
              Material deliveries from mines arrive daily. Mining rules depend on
              difficulty.
            </p>
          </section>
          <section class="panel help-card">
            <p class="eyebrow">ELECTRICITY AND FUEL</p>
            <h2>Generate power as it is needed</h2>
            <p>
              Power stations must meet electricity demand each day. Coal- and gas-fired stations
              draw from one shared fossil-fuel stock and domestic reserve, measured in gigajoules
              of fuel. Extraction sites mine the stock from finite deposits, limited by their
              maintenance. Burned fuel is gone for good and cannot be recycled. Most starting power
              stations use fossil fuels, but their extraction capacity may not keep every station
              running indefinitely.
              Convert an operating coal or gas station to nuclear, hydro, or geothermal in the
              infrastructure list; the old station remains available until the project completes.
              Buy imports through Bancor when local reserves run low.
            </p>
          </section>
          <section class="panel help-card">
            <p class="eyebrow">LAST RESORT</p>
            <h2>Use the Bancor exchange carefully</h2>
            <p>
              Sell surplus resources or materials for Bancor, or buy supplies when short. Prices
              have a buy/sell spread, and purchases are limited by your credit limit and resource
              storage. Use the slider in 0.01-lot increments or type a precise amount; the quote
              shows your current stock, post-trade stock, and Bancor balance. Daily clearing
              charges apply to large balances. Each geopolitical shock permanently raises all
              market prices by 25%.
            </p>
          </section>
          <section class="panel help-card">
            <p class="eyebrow">DIFFICULTY</p>
            <h2>Choose your challenge</h2>
            <p>
              Survival is the easiest setting: basic needs are enough for happiness and
              construction-material mines never run out. Fossil-fuel deposits are finite on every
              difficulty. Emancipation has finite material mines and raises water and energy needs as
              you reach self-sufficiency milestones. Vanguard bans new-material mining and raises
              those needs whenever any single resource becomes self-sufficient. Prebuilt fossil-fuel
              extraction continues on every difficulty. Review the difficulty card
              before starting a campaign.
            </p>
          </section>
        </div>
        <section class="panel help-card help-boosts" aria-labelledby="boost-table-heading">
          <p class="eyebrow">FACILITY SYNERGIES</p>
          <h2 id="boost-table-heading">Production boosts</h2>
          <p class="help-boosts-copy">
            Each active booster increases the output of every listed target facility. Bonuses from
            multiple boosters add together and are scaled by the booster facility's maintenance
            efficiency. Where marked, duplicate boosters contribute less with each additional copy.
          </p>
          <div class="boost-table-wrap">
            <table class="boost-table">
              <thead>
                <tr>
                  <th scope="col">Booster</th>
                  <th scope="col">Boosted facility</th>
                  <th scope="col">Bonus per booster</th>
                  <th scope="col">Duplicate boosters</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="boost in boostRows" :key="boost.key">
                  <th scope="row">{{ boost.source }}</th>
                  <td>{{ boost.target }}</td>
                  <td>+{{ formatPercent(boost.amount) }}</td>
                  <td>
                    {{ boost.falloff < 1
                      ? `Diminishes by ${formatPercent(1 - boost.falloff)} per additional copy`
                      : 'Stacks linearly' }}
                  </td>
                </tr>
                <tr v-if="boostRows.length === 0">
                  <td colspan="4">No facility boosts are configured.</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </template>
    </section>
    </div>
    <footer class="footer">Public services sustain a country. Every day matters.</footer>

    <input ref="loadInput" type="file" accept=".oasave" hidden @change="loadGame">
    <div
      v-if="pendingDemolition"
      class="difficulty-overlay"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="demolish-heading"
      @click.self="pendingDemolition = null"
      @keydown.esc="pendingDemolition = null"
    >
      <div class="confirm-dialog">
        <p class="eyebrow">DEMOLISH FACILITY</p>
        <h2 id="demolish-heading">Demolish {{ pendingDemolition.name }}?</h2>
        <p>The facility keeps operating for {{ pendingDemolition.demolishDays }} days while it is cleared. You then recover:</p>
        <div class="cost-row">
          <span v-for="part in demolitionRecovery" :key="part">{{ part }}</span>
        </div>
        <div class="confirm-actions">
          <button type="button" class="button button-secondary" autofocus @click="pendingDemolition = null">Cancel</button>
          <button type="button" class="button button-primary confirm-danger" @click="confirmDemolition">Demolish</button>
        </div>
      </div>
    </div>
    <div v-if="showDifficultyPicker" class="difficulty-overlay" role="dialog" aria-modal="true" aria-labelledby="difficulty-heading">
      <div class="difficulty-dialog">
        <p class="eyebrow">NEW CAMPAIGN</p>
        <h1 id="difficulty-heading">Choose a difficulty</h1>
        <p class="campaign-premise">
          Water, food, and energy are guarantees everyone should be able to rely on—not charity or
          rewards for work. Build and sustain the public services that meet people's needs. This is
          essential infrastructure for a healthy, thriving country.
        </p>
        <div class="difficulty-grid">
          <article v-for="option in difficultyOptions" :key="option.id" class="difficulty-card">
            <span class="category-badge">{{ option.tier }}</span>
            <h2>{{ option.label }}</h2>
            <p>{{ option.description }}</p>
            <ul>
              <li>{{ formatPopulation(option.population) }} people</li>
              <li>{{ option.reserveYears }} years of water and food reserves</li>
              <li>{{ formatMinesRule(option.mines) }}</li>
              <li>Fossil-fuel deposits are finite</li>
              <li>{{ formatBirthRate(option.dailyBirthRate) }}</li>
            </ul>
            <button type="button" class="button button-primary" @click="startNewGame(option.id)">Start {{ option.label }}</button>
          </article>
        </div>
        <div class="difficulty-footer">
          <button type="button" class="button button-secondary difficulty-cancel" @click="loadInput.click()"><span>Load game</span><span aria-hidden="true">↑</span></button>
          <button v-if="state.elapsedDays > 0" type="button" class="button button-secondary difficulty-cancel" @click="showDifficultyPicker = false">Continue current game</button>
        </div>
        <p v-if="saveError" class="action-error" role="alert">{{ saveError }}</p>
      </div>
    </div>
  </main>
</template>

<style>
:root {
  font-family: 'DM Sans', sans-serif;
  color: #23332f;
  background: #f3f5f0;
  font-synthesis: none;
  text-rendering: optimizeLegibility;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  font-optical-sizing: auto;
  font-weight: 400;
  --green: #2e6551;
  --muted: #81908a;
  --line: #e6ebe5;
}

* { box-sizing: border-box; }
.difficulty-overlay { position: fixed; inset: 0; z-index: 50; display: grid; place-items: center; padding: 24px; background: rgba(35, 51, 47, .6); overflow-y: auto; }
.difficulty-dialog { width: min(960px, 100%); padding: 28px; border-radius: 12px; background: #f3f5f0; }
.confirm-dialog { width: min(420px, 100%); padding: 24px; border-radius: 12px; background: #f3f5f0; }
.confirm-dialog h2 { margin: 4px 0 8px; font-size: 16px; }
.confirm-dialog p { margin: 0; color: #52635a; font-size: 11px; }
.confirm-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 18px; }
.confirm-actions .button { min-width: 96px; justify-content: center; }
.confirm-danger { background: #a8452f; }
.confirm-danger:not(:disabled):hover { background: #8d3825; }
.campaign-premise { max-width: 760px; margin: 12px 0 0; color: #52635b; font-size: 13px; line-height: 1.7; }
.difficulty-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 16px; margin: 20px 0; }
.difficulty-card { display: flex; flex-direction: column; gap: 8px; padding: 18px; border: 1px solid #e6ebe5; border-radius: 10px; background: #fff; }
.difficulty-card h2 { margin: 0; font-size: 20px; }
.difficulty-card p { flex: 1; margin: 0; color: #77877f; font-size: 12px; line-height: 1.6; }
.difficulty-card ul { margin: 0; padding-left: 18px; color: #52635b; font-size: 12px; line-height: 1.7; }
.difficulty-cancel { gap: 8px; padding: 0 16px; }
.difficulty-footer { display: flex; flex-wrap: wrap; gap: 10px; }
body { margin: 0; min-width: 320px; }
button { font: inherit; }
.game-shell { max-width: 1320px; padding: 0 42px; margin: 0 auto; }
.topbar { height: 76px; border-bottom: 1px solid #e1e7e0; display: flex; align-items: center; justify-content: space-between; }
.wordmark { display: flex; align-items: center; gap: 10px; text-decoration: none; color: #263a32; font-size: 13px; font-weight: 800; letter-spacing: 1.15px; }
.wordmark-icon { width: 30px; height: 30px; display: grid; place-items: center; border-radius: 9px; color: white; background: var(--green); font: 800 11px 'Manrope', sans-serif; }
.wordmark-light { color: #7b8b83; font-weight: 500; }
.topbar-right { display: flex; align-items: center; gap: 20px; }
.campaign-label, .quiet-label { color: #8a9690; font-size: 9px; letter-spacing: 1.3px; font-weight: 700; }
.date-pill { padding: 8px 12px; background: #e9eee8; border-radius: 20px; font-size: 11px; color: #52635b; }
.intro { padding: 37px 0 28px; display: flex; justify-content: space-between; align-items: flex-end; gap: 24px; }
.eyebrow { margin: 0 0 9px; color: #7b8c83; font-size: 9px; letter-spacing: 1.6px; font-weight: 700; }
h1, h2, h3, p { margin-top: 0; }
h1, h2, h3, .overview-card strong { font-family: 'Manrope', sans-serif; }
h1 { margin-bottom: 8px; color: #253831; font-size: clamp(26px, 3.2vw, 39px); line-height: 1.16; letter-spacing: -1.5px; }
h1 em { font-style: normal; color: #53836a; }
.intro-copy { margin-bottom: 0; max-width: 540px; color: #77877f; font-size: 13px; line-height: 1.6; }
.campaign-status { flex: 0 0 auto; display: flex; align-items: center; gap: 8px; margin-bottom: 3px; padding: 9px 12px; background: #e7f0e9; border-radius: 20px; color: #3e7652; font-size: 10px; font-weight: 600; }
.campaign-status.status-collapsed { background: #f9e9e5; color: #a64e3e; }
.campaign-status.status-survived { background: #e5eee7; color: #356b4b; }
.status-dot { width: 7px; height: 7px; border-radius: 50%; background: currentColor; }
.overview-grid { display: grid; grid-template-columns: 1fr 1.25fr 1.25fr 1fr; gap: 12px; margin-bottom: 19px; }
.overview-card, .panel { border: 1px solid #e6ebe5; border-radius: 10px; background: #fff; }
.overview-card { min-height: 110px; padding: 17px 18px; display: flex; flex-direction: column; justify-content: center; }
.card-label { color: #84918b; font-size: 9px; font-weight: 700; letter-spacing: 1.15px; }
.overview-card > strong { margin-top: 8px; font-size: 26px; line-height: 1; letter-spacing: -.8px; }
.overview-card > strong small { font: 500 11px 'DM Sans', sans-serif; color: #8b9691; letter-spacing: 0; }
.card-foot { margin-top: 7px; color: #8a9690; font-size: 10px; }
.stat-heading { display: flex; align-items: center; justify-content: space-between; }
.stat-heading strong { color: #355a49; font: 700 18px 'Manrope', sans-serif; }
.meter { overflow: hidden; height: 5px; border-radius: 8px; background: #edf0ec; }
.overview-card .meter { margin-top: 10px; }
.meter > span { display: block; height: 100%; border-radius: inherit; transition: width .25s ease; }
.health-meter { background: #5d9b70; }
.happiness-meter { background: #d3a751; }
.time-meter, .project-meter { background: #5c8b70; }
.simulation-layout { display: grid; grid-template-columns: minmax(0, 1.65fr) minmax(310px, .95fr); align-items: start; gap: 18px; }
.main-column, .side-column { display: flex; flex-direction: column; gap: 16px; }
.panel { padding: 20px; }
.service-record-panel { margin-top: 16px; }
.service-record-score { color: #355a49; font: 700 16px 'Manrope', sans-serif; }
.service-outcome { margin: 12px 0; color: #52635b; font-size: 11px; line-height: 1.6; }
.service-shortfall-list { display: flex; flex-wrap: wrap; gap: 8px 18px; color: #77877f; font-size: 10px; }
.service-shortfall-list strong { color: #355a49; }
.score-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 10px; margin: 12px 0; }
.score-card { display: flex; flex-direction: column; gap: 4px; padding: 12px; border: 1px solid #e6ebe5; border-radius: 8px; background: #f8faf7; }
.score-card strong { color: #355a49; font: 700 20px 'Manrope', sans-serif; }
.score-card small { color: #8a9690; font-size: 9px; }
.section-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.section-heading .eyebrow { margin-bottom: 5px; }
h2 { margin-bottom: 0; color: #293a33; font-size: 16px; letter-spacing: -.35px; }
.resource-list { margin-top: 18px; }
.resource-explainer { margin: 12px 0 0; color: #87938d; font-size: 10px; line-height: 1.6; }
.resource-row { display: grid; grid-template-columns: 125px minmax(0, 1fr); align-items: center; padding: 16px 0; border-top: 1px solid #eef1ed; }
.resource-row:first-child { border-top: 0; }
.resource-name { display: flex; align-items: center; gap: 10px; }
.resource-icon { width: 31px; height: 31px; border-radius: 9px; display: grid; place-items: center; font-size: 11px; font-weight: 700; }
.icon-water { background: #e8f2f3; color: #49889a; }
.icon-food { background: #f4efe2; color: #9c7d39; }
.icon-energy { background: #f5eee4; color: #b17c3d; }
.resource-name strong, .resource-name div > span { display: block; }
.resource-name strong { color: #37463f; font-size: 12px; }
.resource-name div > span { margin-top: 3px; color: #929d97; font-size: 10px; }
.resource-details { display: grid; grid-template-columns: 90px minmax(100px, 1fr) minmax(160px, 1.25fr); align-items: center; gap: 14px; }
.resource-amount strong { display: block; color: #34443c; font: 700 13px 'Manrope', sans-serif; }
.resource-amount span, .resource-meter > span { display: block; margin-top: 4px; color: #8b9791; font-size: 9px; }
.resource-meter .meter { height: 5px; }
.resource-meter-water { background: #65a2b1; }
.resource-meter-food { background: #bf9b51; }
.resource-meter-energy { background: #d18d43; }
.resource-flow { display: flex; flex-direction: column; gap: 3px; color: #8b9690; font-size: 9px; }
.resource-flow b { color: #54655d; font-weight: 600; }
.resource-flow .runway { color: #557a62; font-weight: 600; }
.bancor-balance { color: #3e7652; font: 700 16px 'Manrope', sans-serif; }
.bancor-negative { color: #a64e3e; }
.trade-form { margin-top: 15px; }
.trade-fields { display: grid; grid-template-columns: .8fr 1.5fr .7fr; gap: 9px; }
.trade-fields label { min-width: 0; color: #718078; font-size: 9px; font-weight: 600; }
.trade-fields label > span { display: block; margin-bottom: 5px; }
.trade-fields select, .trade-fields input { width: 100%; min-height: 36px; padding: 0 8px; border: 1px solid #e5eae4; border-radius: 6px; background: #fff; color: #35463e; font: inherit; font-size: 10px; }
.trade-fields select:focus, .trade-fields input:focus { outline: 2px solid #91b49b; outline-offset: 1px; }
.trade-slider-label { display: flex; justify-content: space-between; gap: 10px; margin-top: 13px; color: #718078; font-size: 9px; }
.trade-slider-label strong { color: #42644e; font: 700 10px 'Manrope', sans-serif; }
.trade-range { width: 100%; margin: 8px 0 2px; accent-color: #4c8060; cursor: pointer; }
.trade-range:disabled { cursor: not-allowed; opacity: .48; }
.trade-quote { display: flex; flex-wrap: wrap; gap: 7px 16px; margin-top: 13px; color: #7d8983; font-size: 9px; }
.trade-quote strong { color: #40574a; }
.trade-error { color: #a64e3e; }
.trade-button { width: 100%; margin-top: 12px; }
.bancor-terms { display: flex; flex-wrap: wrap; gap: 6px 15px; margin-top: 12px; color: #89958f; font-size: 8px; line-height: 1.5; }
.fee-warning { color: #a36a32; }
.help-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
.help-card h2 { margin-bottom: 10px; }
.help-card > p:last-child { margin-bottom: 0; color: #718078; font-size: 11px; line-height: 1.7; }
.help-boosts { margin-top: 14px; }
.help-boosts-copy { margin: 0 0 12px; color: #718078; font-size: 11px; line-height: 1.7; }
.boost-table-wrap { overflow-x: auto; }
.boost-table { width: 100%; border-collapse: collapse; color: #718078; font-size: 10px; text-align: left; }
.boost-table th, .boost-table td { padding: 9px 10px; border-top: 1px solid #eef1ed; }
.boost-table thead th { color: #84918b; font-size: 9px; font-weight: 700; }
.boost-table tbody th { color: #40574a; font-weight: 600; }
.material-list { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-top: 18px; }
.material { display: flex; align-items: center; gap: 7px; padding: 11px; border: 1px solid #edf0ec; border-radius: 7px; color: #77847d; font-size: 10px; text-transform: capitalize; }
.material strong { margin-left: auto; color: #35473e; font: 700 12px 'Manrope', sans-serif; }
.material-icon { background: #f1f4f0; }
.resource-details.material-details { grid-template-columns: minmax(0, 1.2fr) minmax(110px, 1fr); }
.material-mark { width: 7px; height: 7px; border-radius: 2px; background: #78868f; }
.mark-silicon { background: #b29d72; }
.mark-components { background: #6e9a80; }
.small-note { margin: 12px 0 0; color: #87938d; font-size: 10px; line-height: 1.6; }
.maintenance-warning { margin: 12px 0 0; color: #a45b48; font-size: 10px; line-height: 1.5; }
.event-list { margin-top: 15px; }
.event-row { display: flex; gap: 11px; padding: 10px 0; border-top: 1px solid #eef1ed; color: #596961; font-size: 10px; line-height: 1.5; }
.event-day { flex: 0 0 46px; color: #95a099; font-size: 8px; font-weight: 700; letter-spacing: .5px; }
.panel-copy { margin: 10px 0 14px; color: #85928b; font-size: 10px; line-height: 1.6; }
.ration-control { padding: 13px 0 2px; border-top: 1px solid #eef1ed; }
.ration-heading { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; }
.ration-heading label { color: #35463e; font-size: 11px; font-weight: 600; }
.ration-heading strong { color: #42644e; font: 700 11px 'Manrope', sans-serif; text-align: right; }
.ration-heading strong span { color: #89958f; font: 400 9px 'DM Sans', sans-serif; }
.ration-control input[type='range'] { width: 100%; margin: 13px 0 5px; accent-color: #4c8060; cursor: pointer; }
.ration-scale { display: flex; justify-content: space-between; gap: 8px; color: #8b9690; font-size: 8px; }
.ration-extra { margin: 10px 0 0; color: #557a62; font-size: 9px; line-height: 1.5; }
.ration-warning { margin: 10px 0 0; color: #a36a32; font-size: 9px; line-height: 1.5; }
.ration-warning-critical { color: #a64e3e; }
.turn-buttons { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.advance-slider { display: flex; justify-content: space-between; align-items: baseline; color: #35463e; font-size: 11px; font-weight: 600; }
.advance-slider strong { color: #42644e; font: 700 11px 'Manrope', sans-serif; }
.advance-range { width: 100%; margin: 12px 0 5px; accent-color: #4c8060; cursor: pointer; }
.advance-scale { margin-bottom: 12px; }
.advance-button { width: 100%; }
.button { min-height: 37px; border: 0; border-radius: 6px; cursor: pointer; font-size: 10px; font-weight: 600; transition: background .15s, opacity .15s; }
.button:disabled { cursor: not-allowed; opacity: .48; }
.button-primary { display: flex; align-items: center; justify-content: space-between; padding: 0 11px; background: #356d52; color: white; }
.button-primary:not(:disabled):hover { background: #285d43; }
.button-secondary { display: flex; align-items: center; justify-content: space-between; padding: 0 11px; border: 1px solid #e5eae4; background: white; color: #52635a; }
.button-secondary:not(:disabled):hover, .build-button:not(:disabled):hover { background: #f2f6f1; }
.management-panel { padding-bottom: 17px; container-type: inline-size; }
.infrastructure-columns { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; margin-top: 16px; }
.infrastructure-column { min-width: 0; }
.infrastructure-column-heading { margin: 0 0 7px; color: #718078; font-size: 9px; font-weight: 700; letter-spacing: .8px; text-transform: uppercase; }
.infrastructure-scroll { height: 420px; overflow-y: auto; padding-right: 8px; scrollbar-width: thin; scrollbar-color: #b8c9bc #f0f4ef; }
.building-search-label { display: block; margin-top: 15px; color: #718078; font-size: 9px; font-weight: 600; }
.building-search { width: 100%; min-height: 36px; margin-top: 6px; padding: 0 10px; border: 1px solid #e5eae4; border-radius: 6px; color: #35463e; font: inherit; font-size: 10px; }
.building-search:focus { outline: 2px solid #91b49b; outline-offset: 1px; }
.category-filters { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 9px; }
.category-filter { padding: 6px 9px; border: 1px solid #e5eae4; border-radius: 14px; background: #fff; color: #718078; cursor: pointer; font-size: 8px; }
.category-filter-active { border-color: #a9c5af; background: #edf4ee; color: #3d6c4a; }
.project-card { margin: 0 0 10px; padding: 12px; border-radius: 7px; background: #f0f5f0; }
.project-topline { display: flex; justify-content: space-between; color: #71847a; font-size: 8px; font-weight: 700; letter-spacing: .8px; }
.project-topline strong { color: #456a52; font-size: 10px; letter-spacing: 0; }
.project-name { display: block; margin: 7px 0 9px; color: #40574a; font-size: 11px; }
.category-badge { display: inline-block; margin-top: 5px; padding: 3px 6px; border-radius: 9px; background: #edf2ed; color: #718078; font-size: 8px; text-transform: capitalize; }
.project-card .meter { background: #dfe9df; }
.view-toggle { display: flex; gap: 5px; margin-top: 14px; }
.chart-controls { display: grid; grid-template-columns: 1fr 1fr; gap: 9px; margin-top: 14px; }
.chart-controls label { color: #718078; font-size: 9px; font-weight: 600; }
.chart-controls label > span { display: block; margin-bottom: 5px; }
.chart-controls select { width: 100%; min-height: 36px; padding: 0 8px; border: 1px solid #e5eae4; border-radius: 6px; background: #fff; color: #35463e; font: inherit; font-size: 10px; }
.building-card { padding: 13px 0; border-top: 1px solid #edf0ec; }
.building-title { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; }
.building-title h3 { margin: 0; color: #35463e; font-size: 11px; }
.built-count { display: inline-block; margin-top: 4px; color: #5d8568; font-size: 8px; font-weight: 700; letter-spacing: .6px; }
.facility-efficiency { display: block; margin-top: 4px; color: #718078; font-size: 8px; }
.build-time { flex: 0 0 auto; color: #8b9791; font-size: 9px; }
.building-card > p { margin: 6px 0; color: #85918b; font-size: 9px; line-height: 1.5; }
.building-output { display: block; color: #54755e; font-size: 9px; font-weight: 600; }
.cost-row { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 9px; }
.cost-row span { padding: 4px 6px; border-radius: 4px; background: #f2f4f1; color: #77847d; font-size: 8px; text-transform: capitalize; }
.cost-row .cost-missing { background: #f8ece8; color: #a55e4d; }
.build-button { width: 100%; min-height: 32px; margin-top: 9px; border: 1px solid #e5eae4; background: #fff; color: #4a6554; font-size: 9px; }
.action-error { margin: 10px 0 0; color: #a64e3e; font-size: 10px; }
.footer { padding: 22px 0 30px; color: #929d97; text-align: center; font-size: 9px; letter-spacing: .25px; }

@container (max-width: 420px) {
  .infrastructure-columns { grid-template-columns: 1fr; }
}

@media (max-width: 900px) {
  .game-shell { padding: 0 24px; }
  .simulation-layout { grid-template-columns: minmax(0, 1.25fr) minmax(290px, .9fr); gap: 12px; }
  .overview-grid { grid-template-columns: repeat(2, 1fr); }
  .resource-row { grid-template-columns: 100px minmax(0, 1fr); }
  .resource-details { grid-template-columns: 75px minmax(85px, 1fr); }
  .resource-flow { grid-column: 1 / -1; flex-direction: row; flex-wrap: wrap; justify-content: space-between; }
}
@media (max-width: 680px) {
  .game-shell { padding: 0 16px; }
  .topbar { height: 64px; }
  .campaign-label { display: none; }
  .date-pill { font-size: 9px; }
  .intro { padding: 28px 0 20px; flex-direction: column; align-items: flex-start; }
  .intro-copy { font-size: 12px; }
  .overview-grid { gap: 8px; }
  .overview-card { min-height: 100px; padding: 13px; }
  .overview-card > strong { font-size: 22px; }
  .simulation-layout { grid-template-columns: 1fr; }
  .main-column, .side-column { gap: 12px; }
  .panel { padding: 16px; }
  .resource-row { grid-template-columns: 1fr; gap: 12px; }
  .resource-details { grid-template-columns: 82px minmax(80px, 1fr); gap: 10px; }
  .resource-flow { gap: 5px 12px; }
  .quiet-label { font-size: 8px; text-align: right; }
  .trade-fields { grid-template-columns: 1fr 1fr; }
  .trade-fields label:nth-child(2) { grid-column: 1 / -1; grid-row: 2; }
}

.game-shell { max-width: 1480px; padding: 0 28px; }
.global-header { position: sticky; top: 0; z-index: 10; margin: 0 -28px 20px; padding: 5px 28px 0; border-bottom: 1px solid #dfe7df; background: rgba(248, 250, 247, .97); backdrop-filter: blur(12px); }
.global-header-nav { display: grid; grid-template-columns: auto minmax(0, 1fr); align-items: center; gap: 12px; }
.shell-body { display: grid; grid-template-columns: minmax(0, 1fr) 190px; align-items: start; gap: 20px; }
.shell-body > .workspace { grid-column: 1; grid-row: 1; min-width: 0; }
.status-sidebar { grid-column: 2; grid-row: 1; position: sticky; top: 76px; display: flex; flex-direction: column; gap: 16px; padding: 16px; border: 1px solid #e6ebe5; border-radius: 10px; background: #fff; }
.status-sidebar .meter { max-width: none; }
.build-cart { margin-top: 14px; padding-top: 12px; border-top: 1px solid #edf0ec; }
.cart-lines { display: grid; gap: 5px; margin: 0 0 4px; padding: 0; list-style: none; color: #4a5d52; font-size: 10px; }
.cart-lines li { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.cart-remove { border: 0; background: transparent; color: #a64e3e; cursor: pointer; font-size: 10px; }
.cost-row.gain-row span { background: #e7f0e9; color: #3e7652; font-weight: 600; text-transform: none; }
.energy-total { margin: 8px 0 0; color: #8a6d3b; font-size: 9px; }
.energy-total strong { color: #6e5428; }
.cart-actions { display: grid; grid-template-columns: 1fr auto; gap: 8px; margin-top: 12px; }
.cart-actions .button-secondary { padding: 0 14px; }
.queue-control { margin-top: 10px; }
.queue-control label { display: flex; justify-content: space-between; color: #718078; font-size: 9px; font-weight: 600; }
.queue-control label strong { color: #42644e; font: 700 10px 'Manrope', sans-serif; }
.queue-control input[type='range'] { width: 100%; margin: 7px 0 2px; accent-color: #4c8060; cursor: pointer; }
.queue-control input[type='range']:disabled { cursor: not-allowed; opacity: .48; }
.queue-control small { color: #a55e4d; font-size: 9px; }
.global-status { display: none; }
.status-summary { display: grid; grid-template-columns: auto repeat(3, minmax(88px, .7fr)) minmax(130px, 1fr); align-items: center; gap: 20px; flex: 1; }
.campaign-status { display: inline-flex; align-items: center; gap: 7px; width: max-content; margin: 0; padding: 7px 10px; border-radius: 20px; background: #e7f0e9; color: #3e7652; font-size: 10px; font-weight: 600; }
.header-stat { display: flex; flex-direction: column; gap: 4px; }
.header-stat strong { color: #34443c; font: 700 15px 'Manrope', sans-serif; }
.header-stat .meter { width: 100%; max-width: 140px; margin-top: 2px; }
.status-stat-pair { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.horizon-stat { display: flex; flex-direction: column; align-items: stretch; gap: 4px; }
.horizon-heading { display: flex; align-items: center; justify-content: space-between; gap: 6px; }
.horizon-heading .date-pill { padding: 5px 7px; font-size: 8px; white-space: nowrap; }
.horizon-stat .meter { max-width: none; }
.time-controls { display: grid; grid-template-columns: auto 120px auto; align-items: center; gap: 10px; flex: 0 0 auto; }
.time-slider-label { display: flex; flex-direction: column; gap: 3px; color: #718078; font-size: 9px; }
.time-slider-label strong { color: #34443c; font: 700 12px 'Manrope', sans-serif; }
.time-controls .advance-range { margin: 0; }
.time-controls .advance-button { width: auto; min-width: 128px; }
.workspace-nav { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 5px; padding: 0; }
.workspace-tab { min-height: 44px; padding: 9px 14px; border: 0; border-bottom: 2px solid transparent; background: transparent; color: #718078; cursor: pointer; font-size: 11px; font-weight: 600; }
.workspace-tab:hover { background: #f0f4ef; color: #385b48; }
.workspace-tab-active { border-bottom-color: #3d7655; color: #315d43; }
.status-sidebar .sidebar-time-controls { grid-template-columns: 1fr; gap: 8px; width: 100%; padding-top: 14px; border-top: 1px solid #eef1ed; }
.sidebar-time-controls .advance-range { width: 100%; margin: 0; }
.sidebar-time-controls .advance-button { width: 100%; min-width: 0; }
.sidebar-help-link { width: 100%; min-height: 36px; border: 1px solid #e5eae4; border-radius: 6px; background: #fff; color: #52635a; cursor: pointer; font: 600 10px 'DM Sans', sans-serif; text-align: left; padding: 0 11px; }
.sidebar-help-link:hover, .sidebar-help-link[aria-current='page'] { border-color: #a9c5af; background: #edf4ee; color: #315d43; }
.workspace { min-height: 56vh; }
.workspace-heading { display: flex; align-items: end; justify-content: space-between; gap: 20px; margin: 8px 0 18px; }
.workspace-heading .eyebrow { margin-bottom: 6px; }
.workspace-heading h1 { margin: 0; font-size: clamp(24px, 3vw, 34px); }
.panel { padding: 20px; }
.infrastructure-workspace { display: grid; grid-template-columns: minmax(260px, 35fr) minmax(0, 65fr); align-items: stretch; gap: 16px; }
.facility-filters { display: grid; grid-template-columns: minmax(180px, 1fr) 2fr; align-items: end; gap: 9px 16px; margin-bottom: 16px; padding: 14px 16px; border: 1px solid #e6ebe5; border-radius: 10px; background: #fff; }
.facility-filters .building-search-label { grid-column: 1; grid-row: 1; margin: 0; }
.facility-filters .building-search { grid-column: 1; grid-row: 2; margin: -4px 0 0; }
.facility-filters .category-filters { grid-column: 2; grid-row: 2; margin: -4px 0 0; }
.operations-panel, .catalog-panel { min-width: 0; }
.catalog-materials { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; margin-bottom: 14px; }
.catalog-materials-heading { grid-column: 1 / -1; color: #84918b; font-size: 8px; font-weight: 700; letter-spacing: .5px; text-transform: uppercase; }
.catalog-materials-heading small { margin-left: 5px; font-size: inherit; font-weight: 400; letter-spacing: 0; text-transform: none; }
.catalog-material-balance { display: flex; flex-direction: column; gap: 4px; min-width: 0; padding: 8px 10px; border-radius: 6px; background: #f2f5f1; color: #52635a; }
.catalog-material-balance strong { color: #718078; font-size: 9px; font-weight: 600; text-transform: capitalize; }
.catalog-material-fraction { color: #35473e; font: 700 15px 'Manrope', sans-serif; white-space: nowrap; }
.catalog-material-fraction i { padding: 0 3px; color: #98a49d; font-style: normal; font-weight: 400; }
.catalog-material-short { color: #a55e4d; }
.catalog-material-short .catalog-material-fraction { color: #a55e4d; }
.operations-column { display: grid; align-content: start; gap: 16px; min-width: 0; }
.operations-scroll, .catalog-scroll { height: min(64vh, 680px); min-height: 400px; overflow-y: auto; padding: 2px 10px 4px 0; scrollbar-width: thin; scrollbar-color: #b8c9bc #f0f4ef; }
.operations-group { padding: 15px 0; border-top: 1px solid #edf0ec; }
.operations-group:first-child { margin-top: 12px; }
.operations-column .operations-scroll { height: min(26vh, 260px); min-height: 180px; }
.operations-column .operations-scroll.ration-scroll { height: min(30vh, 300px); }
.infrastructure-column-heading { margin: 0 0 9px; color: #718078; font-size: 9px; font-weight: 700; letter-spacing: .8px; text-transform: uppercase; }
.operations-group .project-card { margin-bottom: 8px; }
.operational-list { display: grid; gap: 7px; margin: 0; padding: 0; list-style: none; }
.operational-list li { display: flex; justify-content: space-between; gap: 10px; color: #4a5d52; font-size: 10px; }
.operational-list strong { color: #64816d; font-size: 9px; white-space: nowrap; }
.conversion-control { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 5px 8px; margin-top: 8px; }
.conversion-control label, .conversion-control .upkeep-line { grid-column: 1 / -1; }
.conversion-control select { min-width: 0; padding: 6px; border: 1px solid #dfe6dc; border-radius: 6px; background: white; color: #52635a; font-size: 10px; }
.conversion-control .button { min-height: 28px; font-size: 9px; }
.ration-group .panel-copy { margin-bottom: 8px; }
.ration-group .ration-control:first-of-type { border-top: 0; }
.catalog-scroll { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); align-content: start; column-gap: 18px; }
.catalog-scroll .building-card { min-width: 0; }
.catalog-scroll > .small-note { grid-column: 1 / -1; }
.building-card { padding: 14px 0; }
.building-title { min-height: 34px; }
.building-card > p { min-height: 30px; }
.cost-row { margin-top: 10px; }
.upkeep-line { display: block; margin-top: 6px; color: #8a6d3b; font-size: 9px; text-transform: capitalize; }
.operational-list .upkeep-line { margin-top: 2px; color: #8a9a90; }
.build-button { min-height: 36px; }
.settings-grid { display: grid; grid-template-columns: minmax(0, 1.4fr) minmax(280px, .8fr); gap: 16px; }
.activity-panel .event-list { max-height: 520px; overflow-y: auto; }
.footer { padding-top: 28px; }

@media (max-width: 900px) {
  .game-shell { padding: 0 18px; }
  .global-header { margin-right: -18px; margin-left: -18px; padding-right: 18px; padding-left: 18px; }
  .global-status { align-items: stretch; flex-direction: column; gap: 12px; }
  .status-summary { grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 10px; }
  .shell-body { grid-template-columns: minmax(0, 1fr); }
  .status-sidebar { grid-column: 1; grid-row: 1; position: static; flex-direction: row; flex-wrap: wrap; align-items: center; gap: 12px 24px; }
  .shell-body > .workspace { grid-row: 2; }
  .status-sidebar .sidebar-time-controls { flex: 1 1 180px; }
  .status-stat-pair, .horizon-stat { flex: 1 1 100%; }
  .sidebar-help-link { width: auto; min-width: 120px; }
  .infrastructure-workspace { grid-template-columns: minmax(220px, 35fr) minmax(0, 65fr); gap: 12px; }
  .facility-filters { grid-template-columns: 1fr; }
  .facility-filters .building-search-label, .facility-filters .building-search, .facility-filters .category-filters { grid-column: 1; grid-row: auto; margin: 0; }
}
@media (max-width: 680px) {
  .game-shell { padding: 0 12px; }
  .global-header { margin-right: -12px; margin-left: -12px; padding: 5px 12px 0; }
  .global-header-nav { grid-template-columns: 1fr; gap: 2px; }
  .global-header { padding-top: 5px; }
  .status-summary { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
  .status-summary .campaign-status { grid-column: 1 / -1; }
  .status-sidebar .sidebar-time-controls { flex-basis: 100%; }
  .sidebar-help-link { flex: 1 1 auto; }
  .workspace-nav { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .workspace-tab { min-height: 40px; padding: 7px 5px; font-size: 10px; }
  .help-grid { grid-template-columns: 1fr; }
  .workspace-heading { align-items: flex-start; flex-direction: column; margin-top: 16px; }
  .facility-filters { padding: 12px; }
  .infrastructure-workspace, .settings-grid { grid-template-columns: 1fr; }
  .catalog-materials { gap: 6px; }
  .catalog-material-balance { padding: 7px; }
  .catalog-material-fraction { font-size: 12px; }
  .operations-scroll, .catalog-scroll { height: 420px; min-height: 0; }
  .operations-column .operations-scroll, .operations-column .operations-scroll.ration-scroll { height: 300px; }
  .catalog-scroll { grid-template-columns: 1fr; }
  .catalog-scroll > .small-note { grid-column: 1; }
  .resource-row { grid-template-columns: 1fr; gap: 12px; }
  .resource-details { grid-template-columns: 82px minmax(80px, 1fr); gap: 10px; }
  .resource-flow { gap: 5px 12px; }
  .trade-fields { grid-template-columns: 1fr 1fr; }
  .trade-fields label:nth-child(2) { grid-column: 1 / -1; grid-row: 2; }
}
</style>
