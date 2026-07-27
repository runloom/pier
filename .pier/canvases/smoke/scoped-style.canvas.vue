<script setup>
/**
 * Smoke: scoped CSS must attach __scopeId (Vue fence regression).
 * Open: `.pier/canvases/smoke/scoped-style.canvas.vue`
 */
import { ref } from "vue";
const n = ref(0);
</script>

<script>
export const canvas = {
  description: "Vue scoped style + __scopeId smoke.",
  kind: "composition",
  title: "Vue scoped",
};
</script>

<template>
  <div class="pier-c-frame">
    <div class="box">
      <p class="pier-c-text">Scoped box</p>
      <button class="pier-c-button" type="button" @click="n++">{{ n }}</button>
    </div>
  </div>
</template>

<style scoped>
.box {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: 12px;
}
</style>
