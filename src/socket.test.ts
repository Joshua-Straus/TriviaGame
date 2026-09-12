// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('socket.io-client', () => ({ io: vi.fn(() => ({})) }));

import { emitWithAck, socketEndpoint } from './socket';

afterEach(() => vi.useRealTimers());

describe('Socket.IO endpoint selection', () => {
  const phoneLocation = { protocol: 'http:', hostname: '192.168.1.42' } as Pick<Location, 'protocol' | 'hostname'>;

  it('connects development phones directly to Express on port 3000', () => {
    expect(socketEndpoint(true, phoneLocation)).toBe('http://192.168.1.42:3000');
  });

  it('uses same-origin Socket.IO in production', () => {
    expect(socketEndpoint(false, phoneLocation)).toBeUndefined();
  });

  it('rejects an acknowledgement that never arrives', async () => {
    vi.useFakeTimers();
    const pending = emitWithAck<never>(() => undefined, 25);
    const rejection = expect(pending).rejects.toThrow('did not respond');
    await vi.advanceTimersByTimeAsync(25);
    await rejection;
  });
});
