import { EventEmitter } from 'node:events';
import type { EventPayload } from 'revahub-types';

/**
 * Central event bus that routes module events to task triggers.
 * All module instance events flow through this single EventEmitter.
 */
export class CoreEventBus {
  private emitter = new EventEmitter();

  constructor() {
    this.emitter.setMaxListeners(0);
  }

  /**
   * Emits a structured event payload on the bus.
   * @param payload - The full event payload from a module instance
   */
  emit(payload: EventPayload) {
    this.emitter.emit('event', payload);
  }

  /**
   * Subscribes a listener to all events on the bus.
   * @param listener - Callback receiving each EventPayload
   */
  on(listener: (payload: EventPayload) => void) {
    this.emitter.on('event', listener);
  }

  /**
   * Removes a previously registered event listener.
   * @param listener - The listener to remove
   */
  off(listener: (payload: EventPayload) => void) {
    this.emitter.off('event', listener);
  }

  /** Removes all event listeners. */
  removeAllListeners() {
    this.emitter.removeAllListeners('event');
  }
}
