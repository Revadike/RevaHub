import { ref } from 'vue';

export interface SnackbarOptions {
  text: string;
  color?: 'success' | 'error' | 'warning' | 'info';
  timeout?: number;
}

const show = ref(false);
const text = ref('');
const color = ref<SnackbarOptions['color']>('info');
const timeout = ref(4000);

/**
 * Global snackbar composable for displaying notifications across the app.
 */
export function useSnackbar() {
  function showSnackbar(options: SnackbarOptions) {
    text.value = options.text;
    color.value = options.color ?? 'info';
    timeout.value = options.timeout ?? 4000;
    show.value = true;
  }

  function success(message: string, options?: Omit<SnackbarOptions, 'text' | 'color'>) {
    showSnackbar({ text: message, color: 'success', ...options });
  }

  function error(message: string, options?: Omit<SnackbarOptions, 'text' | 'color'>) {
    showSnackbar({ text: message, color: 'error', ...options });
  }

  function warning(message: string, options?: Omit<SnackbarOptions, 'text' | 'color'>) {
    showSnackbar({ text: message, color: 'warning', ...options });
  }

  function info(message: string, options?: Omit<SnackbarOptions, 'text' | 'color'>) {
    showSnackbar({ text: message, color: 'info', ...options });
  }

  function hide() {
    show.value = false;
  }

  return {
    show,
    text,
    color,
    timeout,
    showSnackbar,
    success,
    error,
    warning,
    info,
    hide
  };
}
