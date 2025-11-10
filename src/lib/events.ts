// Simple event system for real-time updates
type EventCallback = (data: any) => void;

class EventEmitter {
  private listeners: Map<string, EventCallback[]> = new Map();

  on(event: string, callback: EventCallback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event)!.push(callback);
  }

  emit(event: string, data: any) {
    const callbacks = this.listeners.get(event);
    if (callbacks) {
      callbacks.forEach(callback => {
        try {
          callback(data);
        } catch (error) {
          console.error('Error in event callback:', error);
        }
      });
    }
  }

  off(event: string, callback: EventCallback) {
    const callbacks = this.listeners.get(event);
    if (callbacks) {
      const index = callbacks.indexOf(callback);
      if (index > -1) {
        callbacks.splice(index, 1);
      }
    }
  }
}

// Global event emitter instance
export const eventBus = new EventEmitter();

// Event types
export const EVENTS = {
  SHOPPING_LIST_UPDATED: 'shopping-list-updated',
  SHOPPING_LIST_CREATED: 'shopping-list-created',
  SHOPPING_LIST_DELETED: 'shopping-list-deleted',
  GLOBAL_TIMER_CREATED: 'global-timer-created',
  GLOBAL_TIMER_UPDATED: 'global-timer-updated',
  GLOBAL_TIMER_DELETED: 'global-timer-deleted',
} as const; 