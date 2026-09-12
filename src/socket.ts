import { io, type Socket } from 'socket.io-client';
import type { Ack, ClientToServerEvents, ServerToClientEvents } from '../shared/types';

export const ACK_TIMEOUT_MS = 8_000;

/**
 * Vite serves the UI in development, but Socket.IO lives on Express.  Using
 * the page hostname keeps QR codes usable from another device on the LAN.
 */
export function socketEndpoint(
  development = import.meta.env.DEV,
  location: Pick<Location, 'protocol' | 'hostname'> = window.location,
): string | undefined {
  return development ? `${location.protocol}//${location.hostname}:3000` : undefined;
}

export const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io(socketEndpoint(), { autoConnect: true });
export const socketTarget = socketEndpoint() ?? window.location.origin;

export function emitWithAck<T>(
  emit: (ack: Ack<T>) => void,
  timeoutMs = ACK_TIMEOUT_MS,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error(`The game server did not respond within ${Math.ceil(timeoutMs / 1000)} seconds.`)), timeoutMs);
    emit((response) => {
      window.clearTimeout(timeout);
      if (response.ok) resolve(response.data);
      else reject(new Error(response.error));
    });
  });
}
