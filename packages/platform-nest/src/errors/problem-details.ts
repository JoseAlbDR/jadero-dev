/** Base of the `type` URIs of this project's own problem kinds; each gets a public page later. */
export const PROBLEM_TYPE_BASE = "https://jadero.dev/problems/";

/** One invalid field, located by a JSON Pointer into the request body (RFC 9457 section 3). */
export interface InvalidField {
  readonly pointer: string;
  readonly detail: string;
}

/** The RFC 9457 body every error response of a service carries. */
export interface ProblemDetails {
  readonly type: string;
  readonly title: string;
  readonly status: number;
  readonly detail: string;
  readonly instance: string;
  readonly requestId?: string;
  readonly traceId?: string;
  readonly errors?: readonly InvalidField[];
}
