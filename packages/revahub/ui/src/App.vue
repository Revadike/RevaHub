<script setup lang="ts">
  import { ref } from 'vue';
  import { useRouter } from 'vue-router';

  const router = useRouter();
  const drawer = ref(true);

  const navItems = [
    { title: 'Dashboard', icon: 'mdi-view-dashboard', to: '/' },
    { title: 'Instances', icon: 'mdi-puzzle', to: '/instances' },
    { title: 'Tasks', icon: 'mdi-play-circle', to: '/tasks' },
    { title: 'Task Runs', icon: 'mdi-history', to: '/task-runs' },
    { title: 'Marketplace', icon: 'mdi-store', to: '/marketplace' },
    { title: 'Settings', icon: 'mdi-cog', to: '/settings' }
  ];
</script>

<template>
  <v-app>
    <v-navigation-drawer v-model="drawer">
      <v-list-item
        class="pa-4"
        prepend-icon="mdi-hub"
        subtitle="Automation Platform"
        title="RevaHub"
      />
      <v-divider />
      <v-list
        density="compact"
        nav>
        <v-list-item
          v-for="item in navItems"
          :key="item.to"
          :prepend-icon="item.icon"
          :title="item.title"
          :to="item.to"
          @click="router.push(item.to)"
        />
      </v-list>
    </v-navigation-drawer>

    <v-app-bar density="compact">
      <v-app-bar-nav-icon @click="drawer = !drawer" />
      <v-app-bar-title>RevaHub</v-app-bar-title>
    </v-app-bar>

    <v-main>
      <v-container fluid>
        <router-view />
      </v-container>
    </v-main>
  </v-app>
</template>
