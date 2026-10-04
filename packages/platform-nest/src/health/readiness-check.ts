/**
 * One dependency an instance needs before it can serve traffic (a database, later a broker).
 * Each service implements it as a provider; `HealthModule` runs every check on `/health/ready`.
 * A port as an abstract class (ADR-003): the platform knows the shape, the service the details.
 */
export abstract class ReadinessCheck {
  /** The key in the health body, for example `database`. */
  abstract readonly name: string;

  /** Resolves when the dependency answers; throws or rejects when it does not. */
  abstract check(): Promise<void>;
}
