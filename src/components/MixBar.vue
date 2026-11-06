<script setup>
import { computed } from 'vue';

const props = defineProps({
  title: { type: String, default: '' },
  segments: { type: Array, required: true },
  ariaLabel: { type: String, required: true },
});

const normalizedSegments = computed(() => {
  const total = props.segments.reduce(
    (sum, segment) => sum + (Number.isFinite(segment.value) && segment.value > 0 ? segment.value : 0),
    0,
  );
  return props.segments.map((segment) => ({
    ...segment,
    width: total > 0 && Number.isFinite(segment.value) && segment.value > 0
      ? (segment.value / total) * 100
      : 0,
  }));
});
</script>

<template>
  <div class="mix-bar">
    <span v-if="title" class="mix-bar-title">{{ title }}</span>
    <div class="mix-bar-track" role="img" :aria-label="ariaLabel">
      <span
        v-for="segment in normalizedSegments"
        :key="segment.key"
        class="mix-bar-segment"
        :style="{ width: `${segment.width}%`, backgroundColor: segment.color }"
        aria-hidden="true"
      ></span>
    </div>
    <div class="mix-bar-legend">
      <span v-for="segment in normalizedSegments" :key="segment.key">
        <i class="mix-bar-swatch" :style="{ backgroundColor: segment.color }" aria-hidden="true"></i>
        {{ segment.label }} <strong>{{ segment.displayValue }}</strong>
      </span>
    </div>
  </div>
</template>

<style scoped>
.mix-bar-title { display: block; margin-bottom: 5px; color: #8b9791; font-size: 9px; }
.mix-bar-track { display: flex; overflow: hidden; height: 8px; border-radius: 8px; background: #edf0ec; }
.mix-bar-segment { display: block; height: 100%; transition: width .25s ease; }
.mix-bar-legend { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 5px 8px; margin-top: 5px; color: #8b9791; font-size: 8px; }
.mix-bar-legend > span { display: flex; align-items: center; gap: 4px; white-space: nowrap; }
.mix-bar-legend strong { color: #54655d; font-weight: 600; }
.mix-bar-swatch { flex: 0 0 7px; width: 7px; height: 7px; border-radius: 2px; }
</style>
