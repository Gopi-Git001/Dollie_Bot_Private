import { createServer, type Server } from 'node:net';
export async function acquireLock(port = 47741): Promise<Server> {
  const server = createServer(socket => socket.destroy());
  await new Promise<void>((resolve, reject) => { server.once('error', () => reject(new Error('Dottie instance lock unavailable; stop the other instance or check local port 47741'))); server.listen(port, '127.0.0.1', resolve); });
  return server;
}
export async function shutdown(handler: { stop(): Promise<unknown> }, app: { stop(): Promise<unknown> }) { await handler.stop(); await app.stop(); }
