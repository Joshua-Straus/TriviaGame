import { io, type Socket } from 'socket.io-client';
import type { Ack, ClientToServerEvents, ServerToClientEvents } from '../shared/types';

export const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io({ autoConnect: true });

export function emitWithAck<T>(
  emit: (ack: Ack<T>) => void,
): Promise<T> {
  return new Promise((resolve, reject) => {
    emit((response) => {
      if (response.ok) resolve(response.data);
      else reject(new Error(response.error));
    });
  });
}
