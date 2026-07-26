<script setup>
import { ref } from "vue";

/**
 * Vue canvas sample — open in files preview.
 *
 * `pier/canvas` is React-only. Non-React canvases use host shell classes
 * (`pier-c-*`) that mirror Frame / Stack / Text / Badge / Button look via
 * product semantic tokens (installed by installLiveModuleRuntime).
 *
 * Requires: vue + @vue/compiler-sfc
 */
const count = ref(0);
</script>

<template>
  <div class="pier-c-frame">
    <div class="pier-c-stack">
      <h2 class="pier-c-text pier-c-text--title">Smoke</h2>
      <p class="pier-c-text pier-c-text--secondary">
        Vue pipeline ok. Layout classes match host pier/canvas primitives; import
        project SFCs for real product UI under the path fence.
      </p>
      <div class="pier-c-row">
        <span class="pier-c-badge pier-c-badge--neutral">vue · shell</span>
        <button class="pier-c-button" type="button" @click="count++">
          Count {{ count }}
        </button>
      </div>
    </div>
  </div>
</template>
