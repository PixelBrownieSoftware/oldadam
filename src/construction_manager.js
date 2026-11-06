import constructionData from './construction_data.json' with { type: 'json' };

// Daily kWh a facility draws at the baseline population; scaled with production.
export const BUILDINGS = Object.freeze(
  Object.fromEntries(
    Object.entries(constructionData.buildings).map(([id, building]) => [
      id,
      {
        ...building,
        energyUse: constructionData.energyUse[id] ?? 0,
        demolishDays: constructionData.demolishDays[id] ?? 1,
        fuelUse: building.fuelUse ?? {},
      },
    ]),
  ),
);
export const MATERIALS = Object.freeze(constructionData.materials);
export const emptyMaterials = () => Object.fromEntries(MATERIALS.map((material) => [material, 0]));
export const DAILY_MATERIAL_DELIVERY = Object.freeze(constructionData.dailyMaterialDelivery);
export const PLANT_CONVERSION_TARGETS = Object.freeze([
  'nuclearReactor',
  'hydroTurbine',
  'geothermalPlant',
]);

const DAILY_EFFICIENCY_ADJUSTMENT = 0.1;
const EFFICIENCY_SNAP_THRESHOLD = 0.001;
export const DEMOLITION_SALVAGE = 0.5;

function copyBuilding(building) {
  return {
    ...building,
    cost: { ...building.cost },
    production: { ...building.production },
    maintenance: { ...building.maintenance },
    fuelUse: { ...building.fuelUse },
    mining: { ...(building.mining || {}) },
    recycling: { ...(building.recycling || {}) },
  };
}

export class ConstructionManager {
  // startingBuildings is a map of building id to count, e.g. { groundwaterWell: 6 }.
  constructor(startingBuildings = {}) {
    if (!Object.keys(startingBuildings).every((buildingId) => buildingId in BUILDINGS)) {
      throw new Error('Difficulty contains unknown starting buildings.');
    }
    this.buildings = Object.entries(startingBuildings).flatMap(([buildingId, count]) =>
      Array(count).fill(buildingId),
    );
    this.projects = [];
    this.nextProjectId = 1;
    this.maintenanceEfficiencies = this.buildings.map(() => 1);
  }

  serialize() {
    return {
      buildings: [...this.buildings],
      projects: this.projects.map((project) => ({ ...project })),
      nextProjectId: this.nextProjectId,
      maintenanceEfficiencies: [...this.maintenanceEfficiencies],
    };
  }

  restore(data) {
    const buildings = data.buildings ?? [];
    if (!buildings.every((id) => id in BUILDINGS)) throw new Error('Save contains unknown buildings.');
    const projects = data.projects ?? [];
    if (!projects.every((project) => {
      if (!(project.buildingId in BUILDINGS)) return false;
      if (project.type === 'demolition') {
        return Number.isInteger(project.sourceIndex) && buildings[project.sourceIndex] === project.buildingId;
      }
      if (project.type !== 'conversion') return true;
      return (
        PLANT_CONVERSION_TARGETS.includes(project.buildingId) &&
        Number.isInteger(project.sourceIndex) &&
        project.sourceIndex >= 0 &&
        ['coalPowerPlant', 'naturalGasPowerPlant'].includes(project.sourceBuildingId) &&
        buildings[project.sourceIndex] === project.sourceBuildingId
      );
    })) {
      throw new Error('Save contains unknown construction projects.');
    }
    const conversionSources = projects
      .filter((project) => project.type === 'conversion' || project.type === 'demolition')
      .map((project) => project.sourceIndex);
    if (new Set(conversionSources).size !== conversionSources.length) {
      throw new Error('Save contains multiple conversions for the same plant.');
    }
    this.buildings = buildings;
    this.projects = projects.map((project) => ({ ...project }));
    this.nextProjectId = data.nextProjectId;
    this.maintenanceEfficiencies = data.maintenanceEfficiencies ?? [];
  }

  startConstruction(buildingId, materials) {
    const blueprint = BUILDINGS[buildingId];
    if (!blueprint) {
      throw new Error(`Unknown building: ${buildingId}`);
    }

    const missing = MATERIALS.filter((material) => materials[material] < blueprint.cost[material]);
    if (missing.length > 0) {
      throw new Error(`Not enough materials: ${missing.join(', ')}.`);
    }

    for (const material of MATERIALS) {
      materials[material] -= blueprint.cost[material] || 0;
    }

    const project = {
      id: this.nextProjectId++,
      type: 'construction',
      buildingId,
      daysRemaining: blueprint.buildDays,
      totalDays: blueprint.buildDays,
    };
    this.projects.push(project);
    return this.getProject(project);
  }

  getPlantConversionOptions() {
    return PLANT_CONVERSION_TARGETS.map((buildingId) => {
      const target = BUILDINGS[buildingId];
      return {
        buildingId,
        name: target.name,
        days: target.buildDays,
        cost: Object.fromEntries(
          MATERIALS.map((material) => [material, Math.ceil((target.cost[material] || 0) / 2)]),
        ),
      };
    });
  }

  startPlantConversion(sourceIndex, targetId, materials) {
    const sourceBuildingId = this.buildings[sourceIndex];
    if (!['coalPowerPlant', 'naturalGasPowerPlant'].includes(sourceBuildingId)) {
      throw new Error('Only an operating coal or natural-gas power station can be converted.');
    }
    if (!PLANT_CONVERSION_TARGETS.includes(targetId)) {
      throw new Error('Choose a supported conversion target.');
    }
    if (this.projects.some(
      (project) => project.type !== 'construction' && project.sourceIndex === sourceIndex,
    )) {
      throw new Error('This power station is already being converted or demolished.');
    }

    const option = this.getPlantConversionOptions().find(
      (conversion) => conversion.buildingId === targetId,
    );
    const missing = MATERIALS.filter((material) => materials[material] < option.cost[material]);
    if (missing.length > 0) {
      throw new Error(`Not enough materials for conversion: ${missing.join(', ')}.`);
    }

    for (const material of MATERIALS) materials[material] -= option.cost[material];
    const project = {
      id: this.nextProjectId++,
      type: 'conversion',
      buildingId: targetId,
      sourceBuildingId,
      sourceIndex,
      daysRemaining: option.days,
      totalDays: option.days,
    };
    this.projects.push(project);
    return this.getProject(project);
  }

  // Demolition takes time; the facility keeps operating until the crew finishes, then part of its
  // build cost comes back as usable materials.
  startDemolition(index) {
    const buildingId = this.buildings[index];
    if (!buildingId) throw new RangeError('Choose an operating facility to demolish.');
    if (this.projects.some((project) => project.type !== 'construction' && project.sourceIndex === index)) {
      throw new Error('This facility is already being converted or demolished.');
    }
    const days = BUILDINGS[buildingId].demolishDays;
    const project = {
      id: this.nextProjectId++,
      type: 'demolition',
      buildingId,
      sourceIndex: index,
      daysRemaining: days,
      totalDays: days,
    };
    this.projects.push(project);
    return this.getProject(project);
  }

  finishDemolition(index, materials) {
    const building = BUILDINGS[this.buildings[index]];
    const salvage = {};
    for (const material of MATERIALS) {
      const amount = (building.cost[material] ?? 0) * DEMOLITION_SALVAGE;
      if (amount > 0) {
        materials[material] += amount;
        salvage[material] = amount;
      }
    }
    this.buildings.splice(index, 1);
    this.maintenanceEfficiencies.splice(index, 1);
    for (const project of this.projects) {
      if (project.sourceIndex > index) project.sourceIndex -= 1;
    }
    return { building, salvage };
  }

  advanceDay(materials) {
    const completed = [];
    this.projects = this.projects.filter((project) => {
      project.daysRemaining -= 1;
      if (project.daysRemaining > 0) return true;

      const building = BUILDINGS[project.buildingId];
      if (project.type === 'demolition') {
        const { salvage } = this.finishDemolition(project.sourceIndex, materials);
        completed.push({ ...building, demolished: true, salvage });
      } else if (project.type === 'conversion') {
        this.buildings[project.sourceIndex] = building.id;
        this.maintenanceEfficiencies[project.sourceIndex] = 1;
        completed.push({ ...building, conversionFrom: BUILDINGS[project.sourceBuildingId].name });
      } else {
        this.buildings.push(building.id);
        this.maintenanceEfficiencies.push(1);
        completed.push(building);
      }
      return false;
    });
    return completed;
  }

  // Recyclers are switched off (no energy, no upkeep) once the used-up pile is covered by earlier recyclers.
  // Mines are switched off once everything they extract has run out of the ground.
  getIdleBuildings(usedUp = null, virginRemaining = null) {
    const idle = new Set();
    if (virginRemaining) {
      this.buildings.forEach((buildingId, index) => {
        const mined = Object.keys(BUILDINGS[buildingId].mining ?? {});
        if (mined.length > 0 && mined.every((material) => (virginRemaining[material] ?? Infinity) <= 0)) {
          idle.add(index);
        }
      });
    }
    if (!usedUp) return idle;
    const remaining = { ...usedUp };
    this.buildings.forEach((buildingId, index) => {
      const recycling = Object.entries(BUILDINGS[buildingId].recycling ?? {});
      if (recycling.length === 0) return;
      if (!recycling.some(([material]) => remaining[material] > 0)) {
        idle.add(index);
        return;
      }
      const efficiency = this.maintenanceEfficiencies[index] ?? 1;
      for (const [material, amount] of recycling) {
        remaining[material] = Math.max(0, remaining[material] - amount * efficiency);
      }
    });
    return idle;
  }

  // Each working booster adds its boost to every facility of the target type, scaled by its upkeep efficiency.
  // Copies of one booster diminish: the k-th copy counts boostFalloff^k (default 1, i.e. linear).
  getBoostFactors(idle = new Set()) {
    const bonus = {};
    const copies = {};
    this.buildings.forEach((buildingId, index) => {
      if (idle.has(index)) return;
      const building = BUILDINGS[buildingId];
      const efficiency = this.maintenanceEfficiencies[index] ?? 1;
      const falloff = building.boostFalloff ?? 1;
      const k = copies[buildingId] ?? 0;
      copies[buildingId] = k + 1;
      for (const [target, amount] of Object.entries(building.boosts ?? {})) {
        bonus[target] = (bonus[target] ?? 0) + amount * efficiency * falloff ** k;
      }
    });
    return Object.fromEntries(Object.entries(bonus).map(([target, total]) => [target, 1 + total]));
  }

  // Power stations burn fossilFuel straight from the usable materials stock; a shortage throttles them.
  // Burned fuel is gone for good, so it never reaches the used-up pile.
  getOperations(materials = {}, idle = new Set(), outputFactors = {}) {
    const remainingFuel = { ...materials };
    const production = { water: 0, food: 0, energy: 0 };
    const fuelUse = {};
    const boosts = this.getBoostFactors(idle);
    let energyUse = 0;
    let fossilEnergy = 0;

    this.buildings.forEach((buildingId, index) => {
      if (idle.has(index)) return;
      const building = BUILDINGS[buildingId];
      const efficiency = this.maintenanceEfficiencies[index] ?? 1;
      let fuelFactor = 1;

      for (const [fuel, amount] of Object.entries(building.fuelUse)) {
        if (amount > 0 && efficiency > 0) {
          fuelFactor = Math.min(fuelFactor, (remainingFuel[fuel] ?? 0) / (amount * efficiency));
        }
      }
      fuelFactor = Math.max(0, Math.min(fuelFactor, 1));

      for (const [fuel, amount] of Object.entries(building.fuelUse)) {
        const consumed = amount * efficiency * fuelFactor;
        remainingFuel[fuel] = Math.max(0, (remainingFuel[fuel] ?? 0) - consumed);
        fuelUse[fuel] = (fuelUse[fuel] ?? 0) + consumed;
      }
      for (const [resource, amount] of Object.entries(building.production)) {
        const produced =
          amount * efficiency * fuelFactor * (outputFactors[buildingId] ?? 1) * (boosts[buildingId] ?? 1);
        production[resource] += produced;
        if (resource === 'energy' && building.fuelUse.fossilFuel > 0) fossilEnergy += produced;
      }
      energyUse += building.energyUse * efficiency * fuelFactor;
    });

    return { production, fuelUse, energyUse, fossilEnergy };
  }

  sumMaterialOutput(field) {
    const boosts = this.getBoostFactors();
    return this.buildings.reduce(
      (output, buildingId, index) => {
        const building = BUILDINGS[buildingId];
        const efficiency = this.maintenanceEfficiencies[index] ?? 1;
        for (const [material, amount] of Object.entries(building[field] || {})) {
          output[material] += amount * efficiency * (boosts[buildingId] ?? 1);
        }
        return output;
      },
      emptyMaterials(),
    );
  }

  getMiningOutput() {
    return this.sumMaterialOutput('mining');
  }

  getRecyclingCapacity() {
    return this.sumMaterialOutput('recycling');
  }

  getDailyMaintenance(idle = new Set()) {
    return this.buildings.reduce(
      (maintenance, buildingId, index) => {
        if (idle.has(index)) return maintenance;
        const building = BUILDINGS[buildingId];
        for (const material of MATERIALS) {
          maintenance[material] += building.maintenance[material] || 0;
        }
        return maintenance;
      },
      emptyMaterials(),
    );
  }

  // Maintenance consumes usable materials; the worn-out remains go to the used-up pile.
  payMaintenance(materials, usedUp, idle = new Set()) {
    const materialCoverage = Object.fromEntries(
      MATERIALS.map((material) => {
        const required = this.buildings.reduce(
          (total, buildingId, index) =>
            total + (idle.has(index) ? 0 : BUILDINGS[buildingId].maintenance[material] || 0),
          0,
        );
        const coverage = required > 0 ? Math.min(materials[material] / required, 1) : 1;
        materials[material] -= required * coverage;
        usedUp[material] += required * coverage;
        return [material, coverage];
      }),
    );

    this.maintenanceEfficiencies = this.buildings.map((buildingId, index) => {
      if (idle.has(index)) return this.maintenanceEfficiencies[index] ?? 1;
      const maintenance = BUILDINGS[buildingId].maintenance;
      const requiredMaterials = MATERIALS.filter((material) => maintenance[material] > 0);
      if (requiredMaterials.length === 0) return 1;

      const targetEfficiency =
        requiredMaterials.reduce((total, material) => total + materialCoverage[material], 0) /
        requiredMaterials.length;
      const previousEfficiency = this.maintenanceEfficiencies[index] ?? 1;
      const nextEfficiency =
        previousEfficiency +
        (targetEfficiency - previousEfficiency) * DAILY_EFFICIENCY_ADJUSTMENT;
      return Math.abs(targetEfficiency - nextEfficiency) < EFFICIENCY_SNAP_THRESHOLD
        ? targetEfficiency
        : nextEfficiency;
    });

    return this.maintenanceEfficiencies.every((efficiency) => efficiency >= 0.999);
  }

  getProject(project) {
    const building = BUILDINGS[project.buildingId];
    let name = building.name;
    if (project.type === 'conversion') {
      name = `Convert ${BUILDINGS[project.sourceBuildingId].name} to ${building.name}`;
    } else if (project.type === 'demolition') {
      name = `Demolish ${building.name}`;
    }
    return { ...project, name, category: building.category };
  }

  getProjects() {
    return this.projects.map((project) => this.getProject(project));
  }

  getBuildings() {
    return this.buildings.map((buildingId, index) => ({
      ...copyBuilding(BUILDINGS[buildingId]),
      efficiency: this.maintenanceEfficiencies[index] ?? 1,
      buildingIndex: index,
      conversionInProgress: this.projects.some(
        (project) => project.type === 'conversion' && project.sourceIndex === index,
      ),
      demolitionInProgress: this.projects.some(
        (project) => project.type === 'demolition' && project.sourceIndex === index,
      ),
    }));
  }

  // Facilities built or under construction (including conversion targets) count against site limits.
  getSiteUsage(buildingId) {
    return (
      this.buildings.filter((id) => id === buildingId).length +
      this.projects.filter((project) => project.type !== 'demolition' && project.buildingId === buildingId)
        .length
    );
  }

  getStorageBonus(resource) {
    return this.buildings.reduce(
      (total, buildingId) => total + (BUILDINGS[buildingId].storageBonus?.[resource] ?? 0),
      0,
    );
  }

  getBuildingOptions() {
    return Object.values(BUILDINGS).map(copyBuilding);
  }
}
