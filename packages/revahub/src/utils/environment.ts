/**
 * Whether the application is running in development mode.
 */
export const isDev = process.env.NODE_ENV === 'development';

/**
 * Whether the application is running in production mode.
 */
export const isProduction = process.env.NODE_ENV === 'production' || !isDev;
