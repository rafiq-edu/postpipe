import { createServer, type Server } from "node:http";

export type Delivery = { body: string; signature: string };

/** Tiny HTTP server that records every POST body and its PostPipe-Signature header. */
export async function startReceiver(
  port: number,
): Promise<{ deliveries: Delivery[]; close: () => Promise<void> }> {
  const deliveries: Delivery[] = [];
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      deliveries.push({
        body: Buffer.concat(chunks).toString("utf8"),
        signature: String(req.headers["postpipe-signature"] ?? ""),
      });
      res.writeHead(200).end("ok");
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, resolve);
  });
  return {
    deliveries,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
