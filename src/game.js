import {
  BUILDINGS,
  ConstructionManager,
  DAILY_MATERIAL_DELIVERY,
  DEMOLITION_SALVAGE,
  emptyMaterials,
  MATERIALS,
  PLANT_CONVERSION_TARGETS,
} from './construction_manager.js';
import difficultyData from './difficulties.json' with { type: 'json' };
import { GameTimeManager, TimeUnit } from './time_manager.js';

export const DIFFICULTIES = Object.freeze(difficultyData);

const DAYS_PER_MONTH = 30;
const DAYS_PER_YEAR = DAYS_PER_MONTH * 12;
const BANCOR_FEE_REPORT_INTERVAL_DAYS = 14;
const HISTORY_SAMPLE_INTERVAL_DAYS = 1;
const HISTORY_SERIES = Object.freeze([
  'water',
  'food',
  'energy',
  'silicon',
  'steel',
  'components',
  'fossilFuel',
]);
const GAME_YEARS = 20;
const GAME_DAYS = GAME_YEARS * 12 * DAYS_PER_MONTH;
const GLOBAL_PRICE_SHOCK_INCREASE = 1.25;
const GLOBAL_PRICE_SHOCK_WINDOWS = Object.freeze([
  [8.5, 11.5],
  [13.5, 16.5],
]);
const BASELINE_POPULATION = 150000;
// Share of processed material recovered; the rest is lost for good, so only mining or Bancor replaces it.
// Burned fossil fuel is never recovered.
const RECYCLING_YIELD = Object.freeze({ steel: 0.9, silicon: 0.4, components: 0.5, fossilFuel: 0 });
const MILESTONE_COOLDOWN_DAYS = 90;
const NEED_GROWTH_RESOURCES = Object.freeze(['water', 'energy']);

const RESOURCE_CONFIG = Object.freeze({
  water: {
    label: 'Water',
    unit: 'L',
    dailyNeedPerPerson: 50,
    maxRationPerPerson: 100,
    rationWarningThreshold: 0.8,
    shortageHealthImpact: 0.25,
  },
  food: {
    label: 'Food',
    unit: 'kcal',
    dailyNeedPerPerson: 2200,
    maxRationPerPerson: 2750,
    rationWarningThreshold: 0.8,
    shortageHealthImpact: 0.1,
  },
  energy: {
    label: 'Energy',
    unit: 'kWh',
    dailyNeedPerPerson: 4,
    maxRationPerPerson: 8,
    rationWarningThreshold: 0.8,
    shortageHealthImpact: 0.03,
  },
});

const BANCOR_DEBT_LIMIT = 1000;
// Keynes' Clearing Union: both creditors and debtors pay charges on balances
// beyond a fraction of their quota, to push both sides to correct imbalances.
const BANCOR_QUOTA = 150;
const BANCOR_FEE_TIERS = Object.freeze([
  { threshold: 0.5, annualRate: 0.02 },
  { threshold: 0.25, annualRate: 0.01 },
]);

function bancorDailyFee(balance) {
  const size = Math.abs(balance);
  let fee = 0;
  let upper = size;
  for (const { threshold, annualRate } of BANCOR_FEE_TIERS) {
    const lower = threshold * BANCOR_QUOTA;
    if (upper > lower) fee += (upper - lower) * annualRate;
    upper = Math.min(upper, lower);
  }
  return fee / DAYS_PER_YEAR;
}
const BANCOR_TRADE_GOODS = Object.freeze([
  {
    id: 'water',
    label: 'Water',
    kind: 'resource',
    stockKey: 'water',
    unit: 'L',
    lotSize: 10000000,
    lotLabel: '10 million L',
    buyPrice: 3,
    sellPrice: 2,
  },
  {
    id: 'food',
    label: 'Food',
    kind: 'resource',
    stockKey: 'food',
    unit: 'kcal',
    lotSize: 100000000,
    lotLabel: '100 million kcal',
    buyPrice: 3,
    sellPrice: 2,
  },
  {
    id: 'fossilFuel',
    label: 'Fossil fuels',
    kind: 'material',
    stockKey: 'fossilFuel',
    unit: 'GJ fuel',
    lotSize: 18360,
    lotLabel: '18,360 GJ fuel',
    buyPrice: 4,
    sellPrice: 2,
  },
  {
    id: 'steel',
    label: 'Steel',
    kind: 'material',
    stockKey: 'steel',
    unit: 'units',
    lotSize: 1,
    lotLabel: '1 unit',
    buyPrice: 12,
    sellPrice: 8,
  },
  {
    id: 'silicon',
    label: 'Silicon',
    kind: 'material',
    stockKey: 'silicon',
    unit: 'units',
    lotSize: 1,
    lotLabel: '1 unit',
    buyPrice: 16,
    sellPrice: 11,
  },
  {
    id: 'components',
    label: 'Components',
    kind: 'material',
    stockKey: 'components',
    unit: 'units',
    lotSize: 1,
    lotLabel: '1 unit',
    buyPrice: 10,
    sellPrice: 7,
  },
]);

const DAILY_HEALTH_RECOVERY = 0.001;
// Stability is earned by keeping the guarantee and lost quickly when it fails.
const STABILITY_DAILY_GAIN = 1 / 360;
const STABILITY_SHORTFALL_LOSS = 0.02;
const STABILITY_COVERAGE_LOSS = 0.2;
const GUARANTEE_POPULATION_THRESHOLD = 0.9;
const GUARANTEE_COVERAGE_THRESHOLD = 0.95;
const DAILY_HAPPINESS_CHANGE = 0.003;
const STARTING_RATION_RATIO = 1.1;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function round(value, digits = 2) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function getRandomDayInYearWindow([startYear, endYear]) {
  const firstDay = Math.ceil(startYear * DAYS_PER_YEAR);
  const lastDay = Math.floor(endYear * DAYS_PER_YEAR);
  return firstDay + Math.floor(Math.random() * (lastDay - firstDay + 1));
}

// Three dry years somewhere after the first one.
function pickDroughtYears() {
  const years = new Set();
  while (years.size < 3) years.add(1 + Math.floor(Math.random() * (GAME_DAYS / DAYS_PER_YEAR - 1)));
  return [...years].sort((a, b) => a - b);
}

export class BasicNeedsGame {
  constructor(difficultyId = 'survival') {
    this.reset(difficultyId);
  }

  reset(difficultyId = 'survival') {
    const difficulty = DIFFICULTIES[difficultyId];
    if (!difficulty) throw new Error(`Unknown difficulty: ${difficultyId}.`);

    this.difficultyId = difficultyId;
    this.difficulty = difficulty;
    this.populationScale = difficulty.population / BASELINE_POPULATION;
    this.reserveDays = difficulty.reserveYears * DAYS_PER_YEAR;
    this.needMultiplier = { water: 1, food: 1, energy: 1 };
    this.milestones = 0;
    this.lastMilestoneDay = {};
    this.elapsedDays = 0;
    this.population = difficulty.population;
    this.health = 1;
    this.happiness = 0.55;
    this.serviceShortfallDays = { all: 0, water: 0, food: 0, energy: 0 };
    this.serviceRecordStartDay = 0;
    this.scores = { personDays: 0, coveredPersonDays: 0, deaths: 0, happinessSum: 0, stability: 0 };
    this.bancor = 0;
    this.bancorFeesSinceReport = 0;
    this.bancorFeeAccrual = 0;
    this.bancorPriceMultiplier = 1;
    this.globalPriceShockDays = GLOBAL_PRICE_SHOCK_WINDOWS.map(getRandomDayInYearWindow);
    this.droughtYears = pickDroughtYears();
    this.rations = Object.fromEntries(
      Object.entries(RESOURCE_CONFIG).map(([resource, config]) => [
        resource,
        round(config.dailyNeedPerPerson * STARTING_RATION_RATIO, 2),
      ]),
    );
    this.resources = Object.fromEntries(
      Object.entries(RESOURCE_CONFIG).map(([key, config]) => [
        key,
        key === 'energy'
          ? 0
          : this.population * config.dailyNeedPerPerson * this.reserveDays,
      ]),
    );
    this.construction = new ConstructionManager(difficulty.startingBuildings);
    // Materials are split into a usable stock and a used-up pile that only recyclers can restore.
    this.materials = { ...emptyMaterials(), ...difficulty.startingMaterials };
    this.usedUp = emptyMaterials();
    // Reserves not listed by the difficulty are unlimited.
    this.virginRemaining = Object.fromEntries(
      MATERIALS.map((material) => [material, difficulty.virginReserve[material] ?? Infinity]),
    );
    this.status = 'playing';
    this.events = [];
    this.eventSequence = 0;
    this.lastMaintenancePaid = true;
    this.maintenanceEfficiencies = [];
    this.time = new GameTimeManager({
      onDayElapsed: () => this.simulateDay(),
    });
    this.history = { days: [], amount: {}, production: {} };
    for (const series of HISTORY_SERIES) {
      this.history.amount[series] = [];
      this.history.production[series] = [];
    }
    this.recordHistory(this.getProduction());
  }

  get minesAllowed() {
    return this.difficulty.mines !== 'banned';
  }

  // The mining ban covers construction materials only; fossil-fuel extraction always runs.
  canMine(material) {
    return material === 'fossilFuel' || this.minesAllowed;
  }

  baselineNeed(resource) {
    return RESOURCE_CONFIG[resource].dailyNeedPerPerson * this.needMultiplier[resource];
  }

  maxRation(resource) {
    return RESOURCE_CONFIG[resource].maxRationPerPerson * this.needMultiplier[resource];
  }

  storageCapacity(resource) {
    if (resource === 'energy') return 0;
    return (
      this.population * RESOURCE_CONFIG[resource].dailyNeedPerPerson * this.reserveDays +
      this.construction.getStorageBonus(resource)
    );
  }

  // Seasonal flow multiplier per building type; hydro follows the river and dries up in drought years.
  getOutputFactors() {
    const factors = {};
    const year = Math.floor(this.elapsedDays / DAYS_PER_YEAR);
    const dayOfYear = this.elapsedDays % DAYS_PER_YEAR;
    for (const building of this.construction.getBuildingOptions()) {
      const season = building.seasonality;
      if (!season) continue;
      const wave = Math.cos((2 * Math.PI * (dayOfYear - season.peakDay)) / DAYS_PER_YEAR);
      const drought = this.droughtYears.includes(year) ? season.droughtFactor : 1;
      factors[building.id] = Math.max(0, (1 + season.amplitude * wave) * drought);
    }
    return factors;
  }

  recordHistory(production) {
    const materialProduction = this.getMaterialProduction();
    this.history.days.push(this.elapsedDays);
    for (const series of HISTORY_SERIES) {
      const isResource = series in RESOURCE_CONFIG;
      this.history.amount[series].push(isResource ? this.resources[series] : this.materials[series]);
      this.history.production[series].push(
        isResource ? production[series] : materialProduction[series],
      );
    }
  }

  advance(unit = TimeUnit.DAY, amount = 1) {
    if (this.status !== 'playing') return 0;
    return this.time.elapseTurn(unit, amount);
  }

  getSiteLimit(buildingId) {
    return this.difficulty.buildingLimits?.[buildingId] ?? null;
  }

  getBuildLock(buildingId, extra = 0) {
    const building = BUILDINGS[buildingId];
    const mined = Object.keys(building?.mining || {});
    if (mined.some((material) => !this.canMine(material))) {
      return 'Mining is banned on this difficulty.';
    }
    const limit = this.getSiteLimit(buildingId);
    if (limit !== null && this.construction.getSiteUsage(buildingId) + extra >= limit) {
      return `No more suitable ${building.name.toLowerCase()} sites (limit ${limit}).`;
    }
    return null;
  }

  build(buildingId) {
    if (this.status !== 'playing') {
      throw new Error('The simulation has ended.');
    }
    const lock = this.getBuildLock(buildingId);
    if (lock) throw new Error(lock);

    const project = this.construction.startConstruction(buildingId, this.materials);
    this.addEvent(`${project.name} construction started.`);
    return project;
  }

  demolish(index) {
    if (this.status !== 'playing') {
      throw new Error('The simulation has ended.');
    }
    if (!Number.isInteger(index) || index < 0) {
      throw new RangeError('Choose an operating facility to demolish.');
    }
    const project = this.construction.startDemolition(index);
    this.addEvent(`${project.name} started (${project.totalDays} days); the facility keeps operating until it is cleared.`);
    return project;
  }

  convertPlant(sourceIndex, targetId) {
    if (this.status !== 'playing') {
      throw new Error('The simulation has ended.');
    }
    if (!Number.isInteger(sourceIndex) || sourceIndex < 0) {
      throw new RangeError('Choose an operating power station to convert.');
    }
    if (!PLANT_CONVERSION_TARGETS.includes(targetId)) {
      throw new Error('Choose a supported conversion target.');
    }
    const siteLock = this.getBuildLock(targetId);
    if (siteLock) throw new Error(siteLock);
    const project = this.construction.startPlantConversion(
      sourceIndex,
      targetId,
      this.materials,
    );
    this.addEvent(`${project.name} started; the original station remains operational until completion.`);
    return project;
  }

  // Starts several projects at once; nothing is built unless the whole order is affordable.
  buildBatch(orders) {
    if (this.status !== 'playing') {
      throw new Error('The simulation has ended.');
    }
    const entries = Object.entries(orders).filter(([, count]) => count > 0);
    if (entries.length === 0) throw new Error('Add at least one facility to your build list.');

    const totals = Object.fromEntries(MATERIALS.map((material) => [material, 0]));
    for (const [buildingId, count] of entries) {
      if (!BUILDINGS[buildingId]) throw new Error(`Unknown building: ${buildingId}`);
      if (!Number.isInteger(count)) throw new Error('Facility quantities must be whole numbers.');
      const lock = this.getBuildLock(buildingId, Math.max(0, count - 1));
      if (lock) throw new Error(lock);
      for (const material of MATERIALS) {
        totals[material] += (BUILDINGS[buildingId].cost[material] || 0) * count;
      }
    }
    const missing = MATERIALS.filter((material) => this.materials[material] < totals[material]);
    if (missing.length > 0) throw new Error(`Not enough materials: ${missing.join(', ')}.`);

    const summary = [];
    for (const [buildingId, count] of entries) {
      for (let i = 0; i < count; i += 1) {
        this.construction.startConstruction(buildingId, this.materials);
      }
      summary.push(`${count}× ${BUILDINGS[buildingId].name}`);
    }
    this.addEvent(`Construction started: ${summary.join(', ')}.`);
  }

  setRation(resource, amount) {
    const config = RESOURCE_CONFIG[resource];
    if (!config || !(resource in this.rations)) {
      throw new Error(`Rationing is not available for ${resource}.`);
    }

    const ration = Number(amount);
    const minRation = this.baselineNeed(resource);
    const maxRation = this.maxRation(resource);
    if (!Number.isFinite(ration) || ration < minRation || ration > maxRation) {
      throw new RangeError(
        `${config.label} ration must be between ${round(minRation)} and ${round(maxRation)} ${config.unit}.`,
      );
    }
    this.rations[resource] = ration;
  }

  quoteTrade(direction, goodId, lots) {
    const good = this.getTradeGoods().find((item) => item.id === goodId);
    if (!good) return { valid: false, error: `Unknown trade good: ${goodId}.` };
    if (direction !== 'buy' && direction !== 'sell') {
      return { valid: false, error: 'Choose whether to buy or sell.' };
    }

    const lotCount = Number(lots);
    if (
      !Number.isFinite(lotCount) ||
      lotCount < 0.01 ||
      Math.abs(lotCount * 100 - Math.round(lotCount * 100)) > 1e-8
    ) {
      return {
        valid: false,
        error: 'Trade amounts must be at least 0.01 lots and use no more than two decimal places.',
      };
    }

    const quantity = lotCount * good.lotSize;
    const unitPrice = direction === 'buy' ? good.buyPrice : good.sellPrice;
    const total = Math.round(lotCount * unitPrice * 100) / 100;
    const inventory = this.getTradeInventory(good.kind);
    const currentStock = inventory[good.stockKey];

    if (direction === 'sell' && quantity > currentStock) {
      return {
        valid: false,
        error: `You only have ${currentStock} ${good.unit} of ${good.label} available.`,
      };
    }

    if (direction === 'buy' && good.kind === 'resource') {
      if (quantity > this.storageCapacity(good.stockKey) - currentStock) {
        return { valid: false, error: `Not enough ${good.label} storage for that amount.` };
      }
    }

    const balanceAfter =
      Math.round((this.bancor + (direction === 'sell' ? total : -total)) * 100) / 100;
    if (balanceAfter < -BANCOR_DEBT_LIMIT) {
      return {
        valid: false,
        error: `That purchase would exceed the Bancor debt limit of ${BANCOR_DEBT_LIMIT}.`,
      };
    }

    return {
      valid: true,
      direction,
      good,
      lots: lotCount,
      quantity,
      total,
      balanceAfter,
      unitPrice,
    };
  }

  trade(direction, goodId, lots) {
    if (this.status !== 'playing') throw new Error('The simulation has ended.');

    const quote = this.quoteTrade(direction, goodId, lots);
    if (!quote.valid) throw new Error(quote.error);

    const inventory = this.getTradeInventory(quote.good.kind);
    inventory[quote.good.stockKey] += direction === 'buy' ? quote.quantity : -quote.quantity;
    this.bancor = quote.balanceAfter;

    const quantity = `${quote.quantity.toLocaleString()} ${quote.good.unit}`;
    const amount = `${quote.total.toLocaleString()} Bancor`;
    this.addEvent(
      direction === 'buy'
        ? `Bought ${quantity} of ${quote.good.label} for ${amount}.`
        : `Sold ${quantity} of ${quote.good.label} for ${amount}.`,
    );
    return quote;
  }

  getTradeInventory(kind) {
    return kind === 'resource' ? this.resources : this.materials;
  }

  simulateDay() {
    if (this.status !== 'playing') return false;
    this.elapsedDays += 1;

    this.applyGlobalPriceShock();
    this.applyBancorHoldingFee();
    this.deliverMaterials();

    const idleBuildings = this.construction.getIdleBuildings(this.usedUp, this.virginRemaining);
    this.lastMaintenancePaid = this.construction.payMaintenance(this.materials, this.usedUp, idleBuildings);
    this.maintenanceEfficiencies = this.construction.maintenanceEfficiencies;
    this.produceMaterials();
    const operations = this.construction.getOperations(
      this.materials,
      idleBuildings,
      this.getOutputFactors(),
    );
    for (const [fuel, amount] of Object.entries(operations.fuelUse)) {
      this.materials[fuel] = Math.max(0, this.materials[fuel] - amount);
    }
    const production = operations.production;
    production.energy -= operations.energyUse;
    const satisfaction = {};
    const comfort = {};
    let anyServiceShortfall = false;
    let dayCoverage = 1;

    for (const [resource, config] of Object.entries(RESOURCE_CONFIG)) {
      const baseline = this.baselineNeed(resource);
      const needPerPerson = this.rations[resource] ?? baseline;
      const dailyNeed = this.population * needPerPerson;
      const available =
        resource === 'energy'
          ? Math.max(0, production.energy)
          : Math.max(
              0,
              Math.min(
                this.storageCapacity(resource),
                this.resources[resource] + production[resource],
              ),
            );
      if (available < this.population * baseline) {
        this.serviceShortfallDays[resource] += 1;
        anyServiceShortfall = true;
      }
      dayCoverage = Math.min(dayCoverage, Math.min(available / (this.population * baseline), 1));
      const supplySatisfaction =
        dailyNeed > 0 ? Math.min(available / dailyNeed, 1) : needPerPerson === 0 ? 1 : 0;
      const rationSatisfaction = Math.min(needPerPerson / baseline, 1);
      satisfaction[resource] = supplySatisfaction * rationSatisfaction;
      // Generous rations only raise happiness while supply fully covers them.
      comfort[resource] =
        supplySatisfaction < 1
          ? supplySatisfaction * rationSatisfaction
          : needPerPerson / baseline;
      this.resources[resource] =
        resource === 'energy' ? 0 : Math.max(0, available - dailyNeed);

      if (satisfaction[resource] < 1) {
        this.health -= (1 - satisfaction[resource]) * config.shortageHealthImpact;
      }
    }
    if (anyServiceShortfall) this.serviceShortfallDays.all += 1;
    // Measured against the starting population so the dead count as uncovered.
    this.scores.personDays += this.difficulty.population;
    this.scores.coveredPersonDays += Math.min(this.population, this.difficulty.population) * dayCoverage;
    this.scores.stability = clamp(
      anyServiceShortfall
        ? this.scores.stability - STABILITY_SHORTFALL_LOSS - STABILITY_COVERAGE_LOSS * (1 - dayCoverage)
        : this.scores.stability + STABILITY_DAILY_GAIN,
      0,
      1,
    );

    if (this.elapsedDays % HISTORY_SAMPLE_INTERVAL_DAYS === 0) {
      this.recordHistory(production);
    }

    const averageSatisfaction =
      (satisfaction.water + satisfaction.food + satisfaction.energy) / 3;
    if (averageSatisfaction === 1) {
      this.health += DAILY_HEALTH_RECOVERY * (1 + this.scores.stability);
    }
    this.health = clamp(this.health, 0, 1);
    const averageComfort = (comfort.water + comfort.food + comfort.energy) / 3;
    this.happiness = clamp(
      this.happiness +
        (averageComfort - this.difficulty.happinessTarget) * DAILY_HAPPINESS_CHANGE,
      0,
      1,
    );
    this.scores.happinessSum += this.happiness;

    if (this.health < 0.5) {
      const mortalityRate = (((0.5 - this.health) / 0.5) ** 2) * 0.5;
      const deaths = this.population * mortalityRate;
      this.population -= deaths;
      this.scores.deaths += deaths;
      if (deaths >= 1) this.addEvent(`${Math.floor(deaths)} people died today.`);
    }
    this.population += this.population * this.difficulty.dailyBirthRate;

    this.checkMilestones(production);

    const completed = this.construction.advanceDay(this.materials);
    this.maintenanceEfficiencies = this.construction.maintenanceEfficiencies;
    for (const building of completed) {
      if (building.demolished) {
        const recovered = Object.entries(building.salvage)
          .map(([material, amount]) => `${round(amount, 2)} ${material}`)
          .join(', ');
        this.addEvent(`${building.name} demolished; recovered ${recovered}.`);
        continue;
      }
      this.addEvent(
        building.conversionFrom
          ? `${building.conversionFrom} converted to ${building.name}; the new plant is operational.`
          : `${building.name} is now operational.`,
      );
    }

    if (!this.lastMaintenancePaid && this.elapsedDays % DAYS_PER_MONTH === 1) {
      this.addEvent('Some facilities are idle because maintenance materials ran out.');
    }
    if (averageSatisfaction < 1 && this.elapsedDays % DAYS_PER_MONTH === 0) {
      this.addEvent('The settlement is running short on essential supplies.');
    }

    if (this.health <= 0 || this.population < 1) {
      this.status = 'collapsed';
      this.addEvent('Civilisation has collapsed.');
      return false;
    }
    if (this.elapsedDays >= GAME_DAYS) {
      this.status = 'survived';
      this.addEvent('The settlement survived the full 20-year simulation.');
      return false;
    }
    return true;
  }

  deliverMaterials() {
    for (const material of MATERIALS) {
      this.extractVirgin(material, DAILY_MATERIAL_DELIVERY[material]);
    }
  }

  // Virgin material comes from mines; finite reserves shrink as they are mined.
  extractVirgin(material, amount) {
    if (!this.canMine(material) || amount <= 0) return 0;
    const before = this.virginRemaining[material];
    const extracted = Math.min(amount, before);
    this.virginRemaining[material] = before - extracted;
    if (before > 0 && this.virginRemaining[material] <= 0) {
      this.addEvent(
        material === 'fossilFuel'
          ? 'Domestic fossil-fuel deposits are exhausted; imports are now required.'
          : `The world's virgin ${material} reserves are exhausted.`,
      );
    }
    this.materials[material] += extracted;
    return extracted;
  }

  produceMaterials() {
    const mining = this.construction.getMiningOutput();
    const recycling = this.construction.getRecyclingCapacity();
    for (const material of MATERIALS) {
      this.extractVirgin(material, mining[material]);
      const processed = Math.min(recycling[material], this.usedUp[material]);
      this.usedUp[material] -= processed;
      this.materials[material] += processed * RECYCLING_YIELD[material];
    }
  }

  getMaterialProduction() {
    const mining = this.construction.getMiningOutput();
    const recycling = this.construction.getRecyclingCapacity();
    return Object.fromEntries(
      MATERIALS.map((material) => {
        const virginRate = mining[material] + DAILY_MATERIAL_DELIVERY[material];
        const virgin = this.canMine(material)
          ? Math.min(virginRate, this.virginRemaining[material])
          : 0;
        const recycled = Math.min(recycling[material], this.usedUp[material]) * RECYCLING_YIELD[material];
        return [material, virgin + recycled];
      }),
    );
  }

  checkMilestones(production) {
    const { milestoneTrigger, needGrowth } = this.difficulty;
    if (!milestoneTrigger) return;

    const isSufficient = (resource) =>
      production[resource] >= this.population * this.baselineNeed(resource);
    const conditions =
      milestoneTrigger === 'all'
        ? { all: Object.keys(RESOURCE_CONFIG).every(isSufficient) }
        : Object.fromEntries(NEED_GROWTH_RESOURCES.map((key) => [key, isSufficient(key)]));

    for (const [key, met] of Object.entries(conditions)) {
      const last = this.lastMilestoneDay[key] ?? -Infinity;
      if (!met || this.elapsedDays - last < MILESTONE_COOLDOWN_DAYS) continue;

      this.lastMilestoneDay[key] = this.elapsedDays;
      this.milestones += 1;
      const [low, high] = needGrowth;
      const rises = NEED_GROWTH_RESOURCES.map((resource) => {
        const growth = round(low + Math.random() * (high - low), 3);
        this.needMultiplier[resource] = round(this.needMultiplier[resource] * (1 + growth), 4);
        // The new baseline is also the new minimum ration.
        this.rations[resource] = Math.max(this.rations[resource], this.baselineNeed(resource));
        return `${RESOURCE_CONFIG[resource].label.toLowerCase()} +${Math.round(growth * 100)}%`;
      });
      const reason = key === 'all' ? 'self-sufficiency' : `${RESOURCE_CONFIG[key].label.toLowerCase()} self-sufficiency`;
      this.addEvent(`Milestone: ${reason} reached. Baseline needs rose (${rises.join(', ')}).`);
    }
  }

  applyBancorHoldingFee() {
    this.bancorFeeAccrual += bancorDailyFee(this.bancor);
    const fee = Math.floor(this.bancorFeeAccrual * 100) / 100;
    if (fee > 0) {
      this.bancorFeeAccrual -= fee;
      this.bancor = Math.round((this.bancor - fee) * 100) / 100;
      this.bancorFeesSinceReport = Math.round((this.bancorFeesSinceReport + fee) * 100) / 100;
    }
    if (this.elapsedDays % BANCOR_FEE_REPORT_INTERVAL_DAYS === 0 && this.bancorFeesSinceReport > 0) {
      this.addEvent(`Bancor clearing charge paid: ${this.bancorFeesSinceReport.toFixed(2)}.`);
      this.bancorFeesSinceReport = 0;
    }
  }

  applyGlobalPriceShock() {
    if (!this.globalPriceShockDays.includes(this.elapsedDays)) return;

    this.bancorPriceMultiplier = round(
      this.bancorPriceMultiplier * GLOBAL_PRICE_SHOCK_INCREASE,
      4,
    );
    this.addEvent('Geopolitical price shock: market prices rose by 25%.');
  }

  getTradeGoods() {
    return BANCOR_TRADE_GOODS.map((good) => {
      const scaled =
        good.kind === 'resource'
          ? {
              lotSize: good.lotSize * this.populationScale,
              lotLabel: `${round((good.lotSize * this.populationScale) / 1000000, 1)} million ${good.unit}`,
            }
          : {};
      return {
        ...good,
        ...scaled,
        buyPrice: round(good.buyPrice * this.bancorPriceMultiplier),
        sellPrice: round(good.sellPrice * this.bancorPriceMultiplier),
      };
    });
  }

  getProduction() {
    const operations = this.construction.getOperations(
      this.materials,
      this.construction.getIdleBuildings(this.usedUp, this.virginRemaining),
      this.getOutputFactors(),
    );
    const production = operations.production;
    // Facilities draw power, so energy production is reported net of their consumption.
    production.energy -= operations.energyUse;
    return production;
  }

  serialize() {
    return {
      elapsedDays: this.elapsedDays,
      population: this.population,
      health: this.health,
      happiness: this.happiness,
      bancor: this.bancor,
      bancorFeesSinceReport: this.bancorFeesSinceReport,
      bancorFeeAccrual: this.bancorFeeAccrual,
      bancorPriceMultiplier: this.bancorPriceMultiplier,
      serviceShortfallDays: { ...this.serviceShortfallDays },
      serviceRecordStartDay: this.serviceRecordStartDay,
      scores: { ...this.scores },
      globalPriceShockDays: [...this.globalPriceShockDays],
      droughtYears: [...this.droughtYears],
      difficulty: this.difficultyId,
      needMultiplier: { ...this.needMultiplier },
      milestones: this.milestones,
      lastMilestoneDay: { ...this.lastMilestoneDay },
      usedUp: { ...this.usedUp },
      virginRemaining: { ...this.virginRemaining },
      rations: { ...this.rations },
      resources: { ...this.resources },
      materials: { ...this.materials },
      status: this.status,
      events: this.events.map((event) => ({ ...event })),
      eventSequence: this.eventSequence,
      lastMaintenancePaid: this.lastMaintenancePaid,
      maintenanceEfficiencies: [...this.maintenanceEfficiencies],
      construction: this.construction.serialize(),
      time: { year: this.time.year, month: this.time.month, day: this.time.day },
      history: {
        days: [...this.history.days],
        amount: Object.fromEntries(
          Object.entries(this.history.amount).map(([key, values]) => [key, [...values]]),
        ),
        production: Object.fromEntries(
          Object.entries(this.history.production).map(([key, values]) => [key, [...values]]),
        ),
      },
    };
  }

  restore(data) {
    const numbers = [
      data?.elapsedDays, data?.population, data?.health, data?.happiness, data?.bancor,
      data?.bancorPriceMultiplier, data?.time?.year, data?.time?.month, data?.time?.day,
    ];
    const resourceKeys = Object.keys(RESOURCE_CONFIG);
    // Saves from before fossil fuel became a material kept it in separate inventories.
    const materials = { ...data?.materials };
    if (materials.fossilFuel === undefined && Number.isFinite(data?.fuels?.fossilFuel)) {
      materials.fossilFuel = data.fuels.fossilFuel;
    }
    const isValid =
      numbers.every(Number.isFinite) &&
      Array.isArray(data.globalPriceShockDays) &&
      resourceKeys.every(
        (key) =>
          Number.isFinite(data.rations?.[key]) &&
          Number.isFinite(data.resources?.[key]) &&
          Array.isArray(data.history?.amount?.[key]) &&
          Array.isArray(data.history?.production?.[key]),
      ) &&
      MATERIALS.every((material) => Number.isFinite(materials[material])) &&
      Array.isArray(data.history?.days) &&
      ['playing', 'collapsed', 'survived'].includes(data.status);
    if (!isValid) throw new Error('Save file does not contain valid game data.');
    if (data.difficulty !== undefined && !(data.difficulty in DIFFICULTIES)) {
      throw new Error('Save file uses an unknown difficulty.');
    }
    const serviceShortfallDays = data.serviceShortfallDays;
    if (
      serviceShortfallDays !== undefined &&
      (
        !serviceShortfallDays ||
        typeof serviceShortfallDays !== 'object' ||
        Array.isArray(serviceShortfallDays) ||
        ['all', ...Object.keys(RESOURCE_CONFIG)].some(
          (key) =>
            !Number.isInteger(serviceShortfallDays[key]) ||
            serviceShortfallDays[key] < 0 ||
            serviceShortfallDays[key] > data.elapsedDays,
        )
      )
    ) {
      throw new Error('Save file contains an invalid public service record.');
    }
    // The record is only trustworthy when saved together with the scores; otherwise start fresh.
    const hasRecord = data.scores !== undefined && serviceShortfallDays !== undefined;
    const serviceRecordStartDay = hasRecord ? (data.serviceRecordStartDay ?? 0) : data.elapsedDays;
    if (
      !Number.isInteger(serviceRecordStartDay) ||
      serviceRecordStartDay < 0 ||
      serviceRecordStartDay > data.elapsedDays ||
      (
        hasRecord &&
        ['all', ...Object.keys(RESOURCE_CONFIG)].some(
          (key) => serviceShortfallDays[key] > data.elapsedDays - serviceRecordStartDay,
        )
      ) ||
      (
        hasRecord &&
        Object.keys(RESOURCE_CONFIG).some(
          (key) => serviceShortfallDays.all < serviceShortfallDays[key],
        )
      )
    ) {
      throw new Error('Save file contains an invalid public service record.');
    }
    const scores = data.scores;
    if (
      scores !== undefined &&
      (
        !scores ||
        typeof scores !== 'object' ||
        ['personDays', 'coveredPersonDays', 'deaths', 'happinessSum', 'stability'].some(
          (key) => !Number.isFinite(scores[key]) || scores[key] < 0,
        ) ||
        scores.stability > 1 ||
        scores.coveredPersonDays > scores.personDays * (1 + 1e-9) ||
        scores.happinessSum > data.elapsedDays - serviceRecordStartDay + 1e-6
      )
    ) {
      throw new Error('Save file contains invalid score data.');
    }

    this.reset(data.difficulty ?? 'survival');
    this.construction.restore(data.construction ?? {});
    if (!this.construction.buildings.includes('fossilFuelMine')) {
      const legacyMineCount = DIFFICULTIES[this.difficultyId].startingBuildings.fossilFuelMine ?? 0;
      this.construction.buildings.push(...Array(legacyMineCount).fill('fossilFuelMine'));
      this.construction.maintenanceEfficiencies.push(...Array(legacyMineCount).fill(1));
    }
    this.needMultiplier = { ...this.needMultiplier, ...data.needMultiplier };
    this.milestones = data.milestones ?? 0;
    this.lastMilestoneDay = { ...data.lastMilestoneDay };
    this.usedUp = { ...this.usedUp, ...data.usedUp };
    this.virginRemaining = {
      ...this.virginRemaining,
      ...data.virginRemaining,
      ...(data.virginRemaining?.fossilFuel === undefined && Number.isFinite(data.fuelReserves?.fossilFuel)
        ? { fossilFuel: data.fuelReserves.fossilFuel }
        : {}),
    };
    this.elapsedDays = data.elapsedDays;
    this.population = data.population;
    this.health = data.health;
    this.happiness = data.happiness;
    if (hasRecord) {
      this.serviceShortfallDays = { ...this.serviceShortfallDays, ...serviceShortfallDays };
      this.scores = { ...scores };
    }
    this.serviceRecordStartDay = serviceRecordStartDay;
    this.bancor = data.bancor;
    this.bancorFeesSinceReport = data.bancorFeesSinceReport ?? 0;
    this.bancorFeeAccrual = data.bancorFeeAccrual ?? 0;
    this.bancorPriceMultiplier = data.bancorPriceMultiplier;
    this.globalPriceShockDays = [...data.globalPriceShockDays];
    this.droughtYears = Array.isArray(data.droughtYears) ? [...data.droughtYears] : pickDroughtYears();
    this.rations = { ...data.rations };
    this.resources = { ...data.resources };
    this.resources.energy = 0;
    this.materials = materials;
    this.status = data.status;
    this.events = (data.events ?? []).map((event) => ({ ...event }));
    this.eventSequence = data.eventSequence ?? 0;
    this.lastMaintenancePaid = data.lastMaintenancePaid !== false;
    this.maintenanceEfficiencies = this.construction.maintenanceEfficiencies;
    this.time.year = data.time.year;
    this.time.month = data.time.month;
    this.time.day = data.time.day;
    // Saves from before materials were charted lack their history, so flatten it to current values.
    const historyDays = data.history.days;
    const restoreSeries = (kind) =>
      Object.fromEntries(
        HISTORY_SERIES.map((key) => [
          key,
          Array.isArray(data.history[kind]?.[key])
            ? [...data.history[kind][key]]
            : historyDays.map(() =>
                kind !== 'amount'
                  ? 0
                  : key in RESOURCE_CONFIG
                    ? data.resources[key]
                    : materials[key],
              ),
        ]),
      );
    this.history = {
      days: [...historyDays],
      amount: restoreSeries('amount'),
      production: restoreSeries('production'),
    };
  }

  addEvent(message) {
    this.events.unshift({
      id: `${this.elapsedDays}-${this.eventSequence++}`,
      day: this.elapsedDays,
      message,
    });
    this.events = this.events.slice(0, 8);
  }

  getScores() {
    const daysTracked = this.elapsedDays - this.serviceRecordStartDay;
    const coverage = this.scores.personDays > 0
      ? this.scores.coveredPersonDays / this.scores.personDays
      : 1;
    const populationKept = this.population / this.difficulty.population;
    let verdict = 'in-progress';
    if (this.status === 'collapsed') verdict = 'collapsed';
    else if (this.status === 'survived') {
      verdict =
        populationKept >= GUARANTEE_POPULATION_THRESHOLD && coverage >= GUARANTEE_COVERAGE_THRESHOLD
          ? 'guarantee-kept'
          : 'guarantee-failed';
    }
    return {
      populationKept,
      deaths: this.scores.deaths,
      coverage,
      meanHappiness: daysTracked > 0 ? this.scores.happinessSum / daysTracked : this.happiness,
      stability: this.scores.stability,
      verdict,
      thresholds: {
        populationKept: GUARANTEE_POPULATION_THRESHOLD,
        coverage: GUARANTEE_COVERAGE_THRESHOLD,
      },
    };
  }

  getState() {
    const idleBuildings = this.construction.getIdleBuildings(this.usedUp, this.virginRemaining);
    const materialProduction = this.getMaterialProduction();
    // Today's mining lands before the power stations burn, so count it toward the stock they can draw on.
    const operations = this.construction.getOperations(
      { ...this.materials, fossilFuel: this.materials.fossilFuel + materialProduction.fossilFuel },
      idleBuildings,
      this.getOutputFactors(),
    );
    const production = operations.production;
    const grossEnergy = production.energy;
    production.energy -= operations.energyUse;
    const dailyNeeds = Object.fromEntries(
      Object.entries(RESOURCE_CONFIG).map(([resource, config]) => [
        resource,
        this.population * (this.rations[resource] ?? this.baselineNeed(resource)),
      ]),
    );
    const resourceState = Object.fromEntries(
      Object.entries(RESOURCE_CONFIG).map(([resource, config]) => [
        resource,
        {
          ...config,
          dailyNeedPerPerson: this.baselineNeed(resource),
          maxRationPerPerson: this.maxRation(resource),
          rationPerPerson: this.rations[resource] ?? this.baselineNeed(resource),
          rationRatio:
            (this.rations[resource] ?? this.baselineNeed(resource)) /
            this.baselineNeed(resource),
          needMultiplier: this.needMultiplier[resource],
          amount: this.resources[resource],
          dailyNeed: dailyNeeds[resource],
          dailyProduction: production[resource],
          facilityUse: resource === 'energy' ? operations.energyUse : 0,
          grossProduction: resource === 'energy' ? grossEnergy : 0,
          fossilProduction: resource === 'energy' ? operations.fossilEnergy : 0,
          fossilShare:
            resource === 'energy' && grossEnergy > 0 ? operations.fossilEnergy / grossEnergy : 0,
          storageCapacity: this.storageCapacity(resource),
          fill:
            resource === 'energy'
              ? 0
              : clamp(this.resources[resource] / this.storageCapacity(resource), 0, 1),
          daysRemaining:
            resource === 'energy'
              ? null
              : dailyNeeds[resource] > production[resource]
                ? this.resources[resource] / (dailyNeeds[resource] - production[resource])
                : Infinity,
        },
      ]),
    );

    return {
      date: this.time.getDateState(),
      elapsedDays: this.elapsedDays,
      totalDays: GAME_DAYS,
      progress: this.elapsedDays / GAME_DAYS,
      population: round(this.population, 1),
      health: this.health,
      happiness: this.happiness,
      status: this.status,
      serviceRecord: {
        daysTracked: this.elapsedDays - this.serviceRecordStartDay,
        daysFullyCovered: this.elapsedDays - this.serviceRecordStartDay - this.serviceShortfallDays.all,
        trackingStartDay: this.serviceRecordStartDay,
        shortfallDays: { ...this.serviceShortfallDays },
      },
      scores: this.getScores(),
      resources: resourceState,
      history: {
        days: [...this.history.days],
        amount: Object.fromEntries(
          Object.entries(this.history.amount).map(([key, values]) => [key, [...values]]),
        ),
        production: Object.fromEntries(
          Object.entries(this.history.production).map(([key, values]) => [key, [...values]]),
        ),
      },
      materials: { ...this.materials },
      usedUp: { ...this.usedUp },
      virginRemaining: { ...this.virginRemaining },
      recyclingYield: { ...RECYCLING_YIELD },
      materialProduction,
      materialBurn: { ...operations.fuelUse },
      materialUpkeep: this.construction.getDailyMaintenance(idleBuildings),
      difficulty: {
        id: this.difficultyId,
        label: this.difficulty.label,
        tier: this.difficulty.tier,
        mines: this.difficulty.mines,
        milestones: this.milestones,
      },
      construction: this.construction.getProjects(),
      buildings: this.construction.getBuildings(),
      plantConversionOptions: this.construction.getPlantConversionOptions(),
      demolitionSalvage: DEMOLITION_SALVAGE,
      buildingOptions: this.construction
        .getBuildingOptions()
        .map((building) => {
          const limit = this.getSiteLimit(building.id);
          return {
            ...building,
            locked: this.getBuildLock(building.id),
            siteLimit: limit,
            siteRemaining: limit === null ? null : Math.max(0, limit - this.construction.getSiteUsage(building.id)),
          };
        }),
      outputFactors: this.getOutputFactors(),
      boostFactors: this.construction.getBoostFactors(idleBuildings),
      droughtYear: this.droughtYears.includes(Math.floor(this.elapsedDays / DAYS_PER_YEAR)),
      events: [...this.events],
      maintenanceOperational: this.lastMaintenancePaid,
      lowestFacilityEfficiency:
        this.maintenanceEfficiencies.length > 0
          ? Math.min(...this.maintenanceEfficiencies)
          : 1,
      bancor: {
        balance: this.bancor,
        debtLimit: BANCOR_DEBT_LIMIT,
        quota: BANCOR_QUOTA,
        feeTiers: BANCOR_FEE_TIERS.map((tier) => ({
          threshold: tier.threshold * BANCOR_QUOTA,
          annualRate: tier.annualRate,
        })).reverse(),
        nextDailyFee: Math.round(bancorDailyFee(this.bancor) * 10000) / 10000,
        tradeGoods: this.getTradeGoods(),
      },
    };
  }

}
