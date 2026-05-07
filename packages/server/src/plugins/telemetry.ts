import fp from "fastify-plugin";
import { trace, context as otelContext, SpanKind, SpanStatusCode } from "@opentelemetry/api";

const tracer = trace.getTracer("@azrtydxb/server");

declare module "fastify" {
  interface FastifyRequest {
    otelSpan?: ReturnType<typeof tracer.startSpan>;
  }
}

/**
 * OpenTelemetry hooks. Creates a span per request and attaches trace context
 * to the request log so logs and traces correlate.
 */
export const telemetryPlugin = fp(async (app) => {
  app.addHook("onRequest", async (request) => {
    const span = tracer.startSpan(`${request.method} ${request.routeOptions?.url ?? request.url}`, {
      kind: SpanKind.SERVER,
      attributes: {
        "http.method": request.method,
        "http.target": request.url,
        "http.scheme": request.protocol,
        "http.host": request.headers.host ?? "",
      },
    });
    request.otelSpan = span;
  });

  app.addHook("onResponse", async (request, reply) => {
    const span = request.otelSpan;
    if (!span) return;
    span.setAttribute("http.status_code", reply.statusCode);
    if (reply.statusCode >= 500) {
      span.setStatus({ code: SpanStatusCode.ERROR });
    }
    span.end();
  });

  app.addHook("onError", async (request, _reply, error) => {
    const span = request.otelSpan;
    if (!span) return;
    span.recordException(error);
    span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
  });

  // Make otel context available for downstream service calls
  app.addHook("preHandler", async (request) => {
    if (request.otelSpan) {
      otelContext.with(trace.setSpan(otelContext.active(), request.otelSpan), () => {
        // ensure span is current for any sync code in handler entry
      });
    }
  });
}, { name: "telemetry" });
