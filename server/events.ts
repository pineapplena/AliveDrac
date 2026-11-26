import { EventEmitter } from 'node:events';

export interface AppEvent {
  type: string;
  data: unknown;
  at: number;
}

export const bus = new EventEmitter();
bus.setMaxListeners(50);

export function publish(type: string, data: unknown): void {
  bus.emit('event', { type, data, at: Date.now() } satisfies AppEvent);
}
