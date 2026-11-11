import type { FastifyInstance, FastifyServerOptions } from "fastify";
import { privateResponseHeaders } from "./security.js";

/** Enforced before session hooks; forwarded headers never determine local access. */
export function restrictLocalTestServer(app: FastifyInstance, trustProxy: FastifyServerOptions["trustProxy"]): void {
  if (trustProxy) throw new Error("Local test login forbids proxy trust");
  app.listen = new Proxy(app.listen, { apply(target, receiver, args: unknown[]) {
    const options = args[0];
    if (!options || typeof options !== "object" || !("host" in options) || options.host !== "127.0.0.1" || "path" in options) {
      throw new Error("Local test login can listen only on explicit host 127.0.0.1");
    }
    return Reflect.apply(target, receiver, args);
  } });
  app.addHook("onRequest", async (request, reply) => {
    const peer = request.raw.socket.remoteAddress;
    const local = peer === "127.0.0.1" || peer === "::1" || peer === "::ffff:127.0.0.1";
    const host = request.headers.host ?? "";
    const forwarded = Object.keys(request.headers).some((key) => key === "forwarded" || key.startsWith("x-forwarded-"));
    if (!local || !/^127\.0\.0\.1(?::[0-9]{1,5})?$/.test(host) || forwarded) {
      privateResponseHeaders(reply);
      return reply.code(403).send({ error: "local_test_only" });
    }
  });
}
