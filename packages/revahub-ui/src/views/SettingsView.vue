<script setup lang="ts">
  import { ref, onMounted } from 'vue';

  import { apiClient } from '../api';

  interface Setting {
    key: string;
    value: unknown;
  }

  const settings = ref<Setting[]>([]);
  const loading = ref(true);
  const saving = ref(false);

  // Editable fields
  const port = ref(3000);

  onMounted(async () => {
    try {
      settings.value = await apiClient.getSettings() as Setting[];
      const portSetting = settings.value.find((s) => s.key === 'port');
      if (portSetting) {
        port.value = portSetting.value as number;
      }
    } catch (err) {
      console.error('Failed to load settings:', err);
    } finally {
      loading.value = false;
    }
  });

  async function savePort() {
    saving.value = true;
    try {
      await apiClient.updateSetting('port', port.value);
    } catch (err) {
      console.error('Failed to save port setting:', err);
    } finally {
      saving.value = false;
    }
  }
</script>

<template>
  <div>
    <h1 class="text-h4 mb-4">
      Settings
    </h1>

    <v-progress-linear
      v-if="loading"
      indeterminate
    />

    <v-card
      v-else
      max-width="600"
    >
      <v-card-text>
        <v-text-field
          v-model.number="port"
          hint="Changes require a restart"
          label="Server Port"
          persistent-hint
          type="number"
        />
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn
          color="primary"
          :loading="saving"
          @click="savePort"
        >
          Save
        </v-btn>
      </v-card-actions>
    </v-card>
  </div>
</template>
