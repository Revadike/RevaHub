<script setup lang="ts">
  import { computed } from 'vue';

  interface OptionDef {
    key: string;
    type: string;
    label: string;
    required?: boolean;
    default?: unknown;
    choices?: Array<{ label: string; value: string | number }>;
    module?: string;
    multi?: boolean;
  }

  interface Instance {
    id: string;
    moduleName: string;
    label: string;
  }

  const props = defineProps<{
    optionDefs: OptionDef[];
    modelValue: Record<string, unknown>;
    instances?: Instance[];
  }>();

  const emit = defineEmits<{
    'update:modelValue': [value: Record<string, unknown>];
  }>();

  const sorted = computed(() =>
    [...props.optionDefs]
      .filter((o) => o.type !== 'trigger')
      .sort((a, b) => ((a as { order?: number }).order ?? 0) - ((b as { order?: number }).order ?? 0))
  );

  function update(key: string, value: unknown) {
    emit('update:modelValue', { ...props.modelValue, [key]: value });
  }

  function instancesForModule(moduleName: string): Array<{ title: string; value: string }> {
    return (props.instances ?? [])
      .filter((i) => i.moduleName === moduleName)
      .map((i) => ({ title: i.label, value: i.id }));
  }
</script>

<template>
  <div>
    <template
      v-for="opt in sorted"
      :key="opt.key"
    >
      <v-select
        v-if="opt.type === 'select'"
        item-title="label"
        item-value="value"
        :items="opt.choices ?? []"
        :label="opt.label"
        :model-value="modelValue[opt.key] ?? opt.default"
        :required="opt.required"
        @update:model-value="update(opt.key, $event)"
      />
      <v-select
        v-else-if="opt.type === 'instance'"
        :items="instancesForModule(opt.module ?? '')"
        :label="opt.label"
        :model-value="modelValue[opt.key]"
        :multiple="opt.multi"
        :required="opt.required"
        @update:model-value="update(opt.key, $event)"
      />
      <v-switch
        v-else-if="opt.type === 'boolean'"
        color="primary"
        :label="opt.label"
        :model-value="(modelValue[opt.key] ?? opt.default) as boolean"
        @update:model-value="update(opt.key, $event)"
      />
      <v-text-field
        v-else-if="opt.type === 'number'"
        :label="opt.label"
        :model-value="modelValue[opt.key] ?? opt.default"
        :required="opt.required"
        type="number"
        @update:model-value="update(opt.key, Number($event))"
      />
      <v-text-field
        v-else-if="opt.type === 'secret'"
        :label="opt.label"
        :model-value="modelValue[opt.key] ?? ''"
        :required="opt.required"
        type="password"
        @update:model-value="update(opt.key, $event)"
      />
      <v-text-field
        v-else
        :label="opt.label"
        :model-value="modelValue[opt.key] ?? opt.default ?? ''"
        :required="opt.required"
        @update:model-value="update(opt.key, $event)"
      />
    </template>
  </div>
</template>
