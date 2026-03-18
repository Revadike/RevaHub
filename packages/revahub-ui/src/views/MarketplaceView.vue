<script setup lang="ts">
  import { ref, onMounted, computed } from 'vue';
  import { apiClient } from '../api';

  interface Package {
    name: string;
    version: string;
    description: string;
  }

  interface InstalledItem {
    name: string;
    version: string;
    label: string;
    source: 'native' | 'npm' | 'local' | 'git';
    status: 'active' | 'missing';
  }

  const searchQuery = ref('');
  const results = ref<Package[]>([]);
  const installedModules = ref<InstalledItem[]>([]);
  const installedTasks = ref<InstalledItem[]>([]);
  const loading = ref(false);
  const actionInProgress = ref<string | null>(null);
  const importDialog = ref(false);
  const importMode = ref<'local' | 'git'>('local');
  const importPath = ref('');
  const importUrl = ref('');
  const importLoading = ref(false);

  const installedNames = computed(() => {
    const names = new Set<string>();
    for (const m of installedModules.value) names.add(m.name);
    for (const t of installedTasks.value) names.add(t.name);
    return names;
  });

  const installedVersions = computed(() => {
    const map = new Map<string, string>();
    for (const m of installedModules.value) map.set(m.name, m.version);
    for (const t of installedTasks.value) map.set(t.name, t.version);
    return map;
  });

  const sourceColors: Record<string, string> = {
    native: 'blue-grey',
    npm: 'orange',
    local: 'teal',
    git: 'purple'
  };

  onMounted(async () => {
    await Promise.all([search(), loadInstalled()]);
  });

  async function loadInstalled() {
    try {
      const [mods, tsks] = await Promise.all([
        apiClient.getModules(),
        apiClient.getTaskPackages()
      ]);
      installedModules.value = mods as InstalledItem[];
      installedTasks.value = tsks as InstalledItem[];
    } catch {
      // ignore
    }
  }

  async function search() {
    loading.value = true;
    try {
      results.value = await apiClient.searchPackages(searchQuery.value || undefined) as Package[];
    } catch (err) {
      console.error('Failed to search packages:', err);
    } finally {
      loading.value = false;
    }
  }

  async function installPackage(name: string) {
    actionInProgress.value = name;
    try {
      await apiClient.installPackage(name);
      await loadInstalled();
    } catch (err) {
      console.error('Failed to install package:', err);
    } finally {
      actionInProgress.value = null;
    }
  }

  async function uninstallPackage(name: string) {
    if (!confirm(`Uninstall ${name}?`)) return;

    actionInProgress.value = name;
    try {
      await apiClient.uninstallPackage(name);
      await loadInstalled();
    } catch (err) {
      console.error('Failed to uninstall package:', err);
    } finally {
      actionInProgress.value = null;
    }
  }

  async function updatePackage(name: string) {
    actionInProgress.value = name;
    try {
      await apiClient.updatePackage(name);
      await loadInstalled();
    } catch (err) {
      console.error('Failed to update package:', err);
    } finally {
      actionInProgress.value = null;
    }
  }

  function openImportDialog(mode: 'local' | 'git') {
    importMode.value = mode;
    importPath.value = '';
    importUrl.value = '';
    importDialog.value = true;
  }

  async function submitImport() {
    importLoading.value = true;
    try {
      if (importMode.value === 'local') {
        await apiClient.importLocalPackage(importPath.value);
      } else {
        await apiClient.importGitPackage(importUrl.value);
      }

      importDialog.value = false;
      await loadInstalled();
    } catch (err) {
      console.error('Failed to import package:', err);
      alert(`Import failed: ${(err as Error).message}`);
    } finally {
      importLoading.value = false;
    }
  }

  function isInstalled(name: string): boolean {
    return installedNames.value.has(name);
  }

  function hasUpdate(pkg: Package): boolean {
    const current = installedVersions.value.get(pkg.name);
    return !!current && current !== pkg.version;
  }

  function packageType(name: string): string {
    if (name.startsWith('revahub-module-')) return 'Module';
    if (name.startsWith('revahub-task-')) return 'Task';

    return 'Unknown';
  }

  function getSource(name: string): string {
    const mod = installedModules.value.find(m => m.name === name);
    if (mod) return mod.source;

    const task = installedTasks.value.find(t => t.name === name);
    if (task) return task.source;

    return 'npm';
  }

  function canUninstall(name: string): boolean {
    const source = getSource(name);
    return source !== 'native';
  }
</script>

<template>
  <div>
    <v-row
      align="center"
      class="mb-4">
      <v-col cols="auto">
        <h1 class="text-h4">Marketplace</h1>
      </v-col>
      <v-spacer />
      <v-col cols="auto">
        <v-btn
          class="mr-2"
          color="teal"
          variant="outlined"
          @click="openImportDialog('local')">
          <v-icon start>mdi-folder-open</v-icon>
          Import Local
        </v-btn>
        <v-btn
          color="purple"
          variant="outlined"
          @click="openImportDialog('git')">
          <v-icon start>mdi-git</v-icon>
          Import Git
        </v-btn>
      </v-col>
    </v-row>

    <v-text-field
      v-model="searchQuery"
      append-inner-icon="mdi-magnify"
      clearable
      label="Search npm packages"
      variant="outlined"
      @click:append-inner="search"
      @keyup.enter="search"
    />

    <v-progress-linear
      v-if="loading"
      indeterminate />

    <v-row v-else>
      <v-col
        v-for="pkg in results"
        :key="pkg.name"
        cols="12"
        md="4">
        <v-card>
          <v-card-title>{{ pkg.name }}</v-card-title>
          <v-card-subtitle>
            <v-chip
              class="mr-2"
              size="small">{{ packageType(pkg.name) }}</v-chip>
            <v-chip
              v-if="isInstalled(pkg.name)"
              class="mr-2"
              :color="sourceColors[getSource(pkg.name)]"
              size="small">{{ getSource(pkg.name) }}</v-chip>
            v{{ pkg.version }}
            <template v-if="isInstalled(pkg.name)">
              <v-chip
                class="ml-1"
                color="success"
                size="small">installed</v-chip>
              <span
                v-if="installedVersions.get(pkg.name) !== pkg.version"
                class="ml-1 text-caption text-warning">
                (current: v{{ installedVersions.get(pkg.name) }})
              </span>
            </template>
          </v-card-subtitle>
          <v-card-text>{{ pkg.description }}</v-card-text>
          <v-card-actions>
            <v-btn
              v-if="!isInstalled(pkg.name)"
              color="primary"
              :loading="actionInProgress === pkg.name"
              @click="installPackage(pkg.name)"
            >
              Install
            </v-btn>
            <v-btn
              v-if="hasUpdate(pkg)"
              color="info"
              :loading="actionInProgress === pkg.name"
              @click="updatePackage(pkg.name)"
            >
              Update
            </v-btn>
            <v-btn
              v-if="isInstalled(pkg.name) && canUninstall(pkg.name)"
              color="error"
              :loading="actionInProgress === pkg.name"
              variant="text"
              @click="uninstallPackage(pkg.name)"
            >
              Uninstall
            </v-btn>
          </v-card-actions>
        </v-card>
      </v-col>
    </v-row>

    <p
      v-if="!loading && results.length === 0"
      class="text-grey mt-4">
      No packages found on npm. Use Import Local or Import Git for development packages.
    </p>

    <!-- Import Dialog -->
    <v-dialog
      v-model="importDialog"
      max-width="500">
      <v-card>
        <v-card-title>
          {{ importMode === 'local' ? 'Import Local Package' : 'Import from Git' }}
        </v-card-title>
        <v-card-text>
          <v-text-field
            v-if="importMode === 'local'"
            v-model="importPath"
            hint="Absolute path to the package directory"
            label="Package Path"
            persistent-hint
            variant="outlined"
          />
          <v-text-field
            v-else
            v-model="importUrl"
            hint="Git repository URL (HTTPS or SSH)"
            label="Git URL"
            persistent-hint
            variant="outlined"
          />
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn
            variant="text"
            @click="importDialog = false">Cancel</v-btn>
          <v-btn
            color="primary"
            :disabled="importMode === 'local' ? !importPath : !importUrl"
            :loading="importLoading"
            @click="submitImport">
            Import
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>
