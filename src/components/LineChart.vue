<script setup>
import { computed, ref } from 'vue';

const props = defineProps({
  x: { type: Array, required: true },
  series: { type: Array, required: true },
  domain: { type: Array, default: null },
  xTicks: { type: Array, default: () => [] },
  formatValue: {
    type: Function,
    default: (value) => new Intl.NumberFormat(undefined, {
      notation: 'compact',
      maximumFractionDigits: 1,
    }).format(value),
  },
  formatX: { type: Function, default: (value) => String(value) },
  valueSuffix: { type: String, default: '' },
  ariaLabel: { type: String, default: 'Line chart' },
});

const dimensions = { width: 560, height: 220, left: 52, right: 12, top: 12, bottom: 22 };
const yTickRatios = [0, 0.25, 0.5, 0.75, 1];
const hoveredIndex = ref(null);

const chartDomain = computed(() => {
  const [start, end] = props.domain || [];
  if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
    return { start, end };
  }

  const values = props.x.filter(Number.isFinite);
  if (!values.length) return { start: 0, end: 1 };
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  return minimum === maximum
    ? { start: minimum - 0.5, end: maximum + 0.5 }
    : { start: minimum, end: maximum };
});

const visibleIndices = computed(() =>
  props.x.reduce((indices, value, index) => {
    if (Number.isFinite(value) && value >= chartDomain.value.start && value <= chartDomain.value.end) {
      indices.push(index);
    }
    return indices;
  }, []),
);

function xPosition(value) {
  const { start, end } = chartDomain.value;
  return (
    dimensions.left +
    ((value - start) / (end - start)) * (dimensions.width - dimensions.left - dimensions.right)
  );
}

function formatCompact(value) {
  return new Intl.NumberFormat(undefined, {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value);
}

const plottedSeries = computed(() => {
  const plotHeight = dimensions.height - dimensions.top - dimensions.bottom;

  return props.series
    .map((item) => {
      const points = visibleIndices.value
        .map((index) => ({ index, x: props.x[index], value: item.values?.[index] }))
        .filter((point) => Number.isFinite(point.value));
      const minimum = Math.min(0, ...points.map(({ value }) => value));
      const maximum = Math.max(0, ...points.map(({ value }) => value));
      const peak = Math.max(maximum, Math.abs(minimum), 1);
      const lower = minimum < 0 ? minimum * 1.1 : 0;
      const upper = maximum > 0 ? Math.max(maximum, 1) * 1.1 : 0;
      const range = upper - lower || 1;
      const latest = [...(item.values || [])].reverse().find(Number.isFinite);

      return {
        ...item,
        peak,
        lower,
        upper,
        latest,
        points: points.map(({ index, x, value }) => ({
          index,
          x,
          y: dimensions.top + plotHeight * (1 - (value - lower) / range),
          value,
        })),
      };
    })
    .filter((item) => item.points.length);
});

const lines = computed(() =>
  plottedSeries.value.map((item) => ({
    ...item,
    coordinates: item.points
      .map(({ x, y }) => `${xPosition(x).toFixed(1)},${y.toFixed(1)}`)
      .join(' '),
  })),
);

const yTicks = computed(() => {
  const plotHeight = dimensions.height - dimensions.top - dimensions.bottom;
  const item = plottedSeries.value.length === 1 ? plottedSeries.value[0] : null;

  return yTickRatios.map((ratio) => ({
    y: dimensions.top + plotHeight * (1 - ratio),
    label: item
      ? formatCompact(item.lower < 0
          ? item.lower + ratio * (item.upper - item.lower)
          : ratio * item.peak)
      : `${Math.round(ratio * 100)}%`,
  }));
});

const effectiveXTicks = computed(() => {
  if (props.xTicks.length) {
    return props.xTicks.filter(
      (tick) => Number.isFinite(tick.value) && tick.value >= chartDomain.value.start && tick.value <= chartDomain.value.end,
    );
  }

  const { start, end } = chartDomain.value;
  return yTickRatios.map((ratio) => {
    const value = start + (end - start) * ratio;
    return { value, label: formatCompact(value) };
  });
});

const hoveredPoint = computed(() => {
  const index = hoveredIndex.value;
  if (index === null || !visibleIndices.value.includes(index)) return null;

  const day = props.x[index];
  const rows = plottedSeries.value.flatMap((item) => {
    const point = item.points.find((entry) => entry.index === index);
    if (!point) return [];
    return [{
      key: item.key,
      label: item.label,
      color: item.color,
      unit: item.unit,
      value: point.value,
      y: point.y,
    }];
  });
  const x = xPosition(day);

  return {
    x,
    day,
    rows,
    leftPercent: (x / dimensions.width) * 100,
    flip: x > dimensions.width * 0.6,
    title: props.formatX(day),
  };
});

function handlePointerMove(event) {
  const { left, width } = event.currentTarget.getBoundingClientRect();
  if (!width || !visibleIndices.value.length) {
    hoveredIndex.value = null;
    return;
  }

  const pointerX = ((event.clientX - left) / width) * dimensions.width;
  const plotWidth = dimensions.width - dimensions.left - dimensions.right;
  if (pointerX < dimensions.left || pointerX > dimensions.width - dimensions.right) {
    hoveredIndex.value = null;
    return;
  }

  const { start, end } = chartDomain.value;
  const value = start + ((pointerX - dimensions.left) / plotWidth) * (end - start);
  let nearestIndex = null;
  let nearestDistance = Infinity;

  for (const index of visibleIndices.value) {
    const distance = Math.abs(props.x[index] - value);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestIndex = index;
    }
  }

  hoveredIndex.value = nearestIndex;
}
</script>

<template>
  <div class="chart-wrap">
    <svg
      class="chart-svg"
      :viewBox="`0 0 ${dimensions.width} ${dimensions.height}`"
      role="img"
      :aria-label="ariaLabel"
      @pointermove="handlePointerMove"
      @pointerleave="hoveredIndex = null"
    >
      <line
        :x1="dimensions.left"
        :x2="dimensions.width - dimensions.right"
        :y1="dimensions.height - dimensions.bottom"
        :y2="dimensions.height - dimensions.bottom"
        class="chart-axis"
      />
      <g v-for="tick in yTicks" :key="tick.y">
        <line
          :x1="dimensions.left"
          :x2="dimensions.width - dimensions.right"
          :y1="tick.y"
          :y2="tick.y"
          class="chart-grid"
        />
        <text
          :x="dimensions.left - 6"
          :y="tick.y + 3"
          class="chart-label"
          text-anchor="end"
        >{{ tick.label }}</text>
      </g>
      <g v-for="tick in effectiveXTicks" :key="tick.value">
        <line
          :x1="xPosition(tick.value)"
          :x2="xPosition(tick.value)"
          :y1="dimensions.top"
          :y2="dimensions.height - dimensions.bottom"
          class="chart-grid"
        />
        <text
          :x="xPosition(tick.value)"
          :y="dimensions.height - 6"
          class="chart-label"
          text-anchor="middle"
        >{{ tick.label }}</text>
      </g>
      <polyline
        v-for="item in lines"
        :key="item.key"
        :points="item.coordinates"
        fill="none"
        :stroke="item.color"
        stroke-width="2"
        stroke-linejoin="round"
      />
      <g v-if="hoveredPoint">
        <line
          :x1="hoveredPoint.x"
          :x2="hoveredPoint.x"
          :y1="dimensions.top"
          :y2="dimensions.height - dimensions.bottom"
          class="chart-cursor"
        />
        <circle
          v-for="row in hoveredPoint.rows"
          :key="row.key"
          :cx="hoveredPoint.x"
          :cy="row.y"
          r="3.5"
          :fill="row.color"
          stroke="#fff"
          stroke-width="1.5"
        />
      </g>
    </svg>
    <div
      v-if="hoveredPoint"
      class="chart-tooltip"
      :style="{
        left: `${hoveredPoint.leftPercent}%`,
        transform: hoveredPoint.flip ? 'translateX(calc(-100% - 10px))' : 'translateX(10px)',
      }"
    >
      <strong>{{ hoveredPoint.title }}</strong>
      <span v-for="row in hoveredPoint.rows" :key="row.key">
        <i :style="{ background: row.color }"></i>
        {{ row.label }}: <b>{{ formatValue(row.value) }}</b> {{ row.unit }}{{ valueSuffix }}
      </span>
    </div>
  </div>
  <div class="chart-legend">
    <span v-for="item in plottedSeries" :key="item.key">
      <i :style="{ background: item.color }"></i>
      {{ item.label }}: {{ formatValue(item.latest) }} {{ item.unit }}{{ valueSuffix }}
      <small>(peak {{ formatValue(item.peak) }})</small>
    </span>
  </div>
</template>

<style scoped>
.chart-svg { display: block; width: 100%; height: auto; margin-top: 14px; touch-action: pan-y; }
.chart-axis { stroke: #cfd8d1; stroke-width: 1; }
.chart-grid { stroke: #eef1ed; stroke-width: 1; }
.chart-label { fill: #8b9791; font-size: 9px; }
.chart-wrap { position: relative; }
.chart-cursor { stroke: #9fb1a6; stroke-width: 1; stroke-dasharray: 3 3; pointer-events: none; }
.chart-tooltip { position: absolute; top: 18px; z-index: 2; display: flex; flex-direction: column; gap: 3px; padding: 8px 10px; border: 1px solid #e0e7df; border-radius: 6px; background: rgba(255, 255, 255, .96); box-shadow: 0 3px 10px rgba(40, 60, 50, .12); color: #596961; font-size: 10px; white-space: nowrap; pointer-events: none; }
.chart-tooltip strong { color: #35463e; font-size: 10px; }
.chart-tooltip i { display: inline-block; width: 7px; height: 7px; margin-right: 5px; border-radius: 2px; }
.chart-tooltip b { color: #35463e; }
.chart-legend { display: flex; flex-wrap: wrap; gap: 6px 16px; margin-top: 10px; color: #596961; font-size: 10px; }
.chart-legend i { display: inline-block; width: 8px; height: 8px; margin-right: 5px; border-radius: 2px; }
.chart-legend small { color: #8b9791; }
</style>