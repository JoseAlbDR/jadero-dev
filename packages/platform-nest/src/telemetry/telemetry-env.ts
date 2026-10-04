import { z } from "zod";

/**
 * The OpenTelemetry variables, under their standard names, validated like every other config
 * (ADR-043). Read by the instrumentation entry before Nest exists.
 */
export const telemetryEnv = z
  .object({
    OTEL_SERVICE_NAME: z.string().min(1),
    OTEL_TRACES_EXPORTER: z.enum(["console", "otlp", "none"]).default("console"),
    OTEL_EXPORTER_OTLP_ENDPOINT: z.url().optional(),
  })
  .superRefine((env, ctx) => {
    if (env.OTEL_TRACES_EXPORTER === "otlp" && !env.OTEL_EXPORTER_OTLP_ENDPOINT) {
      ctx.addIssue({
        code: "custom",
        path: ["OTEL_EXPORTER_OTLP_ENDPOINT"],
        message: "required when OTEL_TRACES_EXPORTER is otlp",
      });
    }
  });

/** The parsed telemetry environment. */
export type TelemetryEnv = z.output<typeof telemetryEnv>;
