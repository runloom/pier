<script>
  /**
   * Svelte canvas sample — open in files preview.
   *
   * `pier/canvas` is React-only. Use host shell classes (`pier-c-*`) for the
   * same Frame / Stack / Text / Badge / Button visual language as React smoke.
   *
   * Requires: svelte
   */
  let count = $state(0);
</script>

<div class="pier-c-frame">
  <div class="pier-c-stack">
    <h2 class="pier-c-text pier-c-text--title">Smoke</h2>
    <p class="pier-c-text pier-c-text--secondary">
      Svelte pipeline ok. Shell classes track host design tokens; compose project
      Svelte components via relative imports under the fence.
    </p>
    <div class="pier-c-row">
      <span class="pier-c-badge pier-c-badge--neutral">svelte · shell</span>
      <button class="pier-c-button" type="button" onclick={() => (count += 1)}>
        Count {count}
      </button>
    </div>
  </div>
</div>
