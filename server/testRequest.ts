import { createServer, type RequestListener, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import supertest from "supertest";

export function createTestRequest() {
  const servers: Server[] = [];
  const clients = new WeakMap<RequestListener, ReturnType<typeof supertest>>();

  function request(app: RequestListener) {
    let client = clients.get(app);
    if (!client) {
      const server = createServer(app).listen(0);
      const { port } = server.address() as AddressInfo;
      servers.push(server);
      client = supertest(`http://[::1]:${port}`);
      clients.set(app, client);
    }
    return client;
  }

  async function closeServers() {
    const closing = servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((err) => {
            if (err) reject(err);
            else resolve();
          });
        })
    );
    await Promise.all(closing);
  }

  return { closeServers, request };
}
