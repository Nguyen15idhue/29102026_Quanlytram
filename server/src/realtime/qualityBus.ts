import { EventEmitter } from 'node:events';

export interface QualityAckEvent {
  alertId: number;
  webUserId: number;
  note: string;
  ts: string;
}

export const qualityBus = new EventEmitter();

export function emitQualityAck(event: QualityAckEvent): void {
  qualityBus.emit('ack', event);
}
