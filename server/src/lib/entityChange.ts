import { emitEntityChange, type EntityChangeEvent } from '../realtime/socket';

export function publishEntityChange(event: EntityChangeEvent): void {
  emitEntityChange(event);
}
