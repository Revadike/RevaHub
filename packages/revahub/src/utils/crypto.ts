import { randomBytes } from 'crypto';

/**
 * Generates a unique ID with the given prefix.
 * @param prefix - The prefix for the ID.
 * @returns A unique string ID.
 */
export function generateId(prefix?: string): string {
  const id = randomBytes(6).toString('hex');
  return prefix ? `${prefix}_${id}` : id;
}
