<script setup lang="ts">
  import { useSnackbar } from '../composables/useSnackbar';

  const { show, text, color, timeout } = useSnackbar();
</script>

<template>
  <v-snackbar
    v-model="show"
    :color="color"
    :timeout="timeout"
  >
    {{ text }}
  </v-snackbar>
</template>
