export class PersistenceError extends Error {
  constructor(
    readonly code: "not_found" | "invalid_storage" | "conflict" | "invalid_resolution" |
      "dependencies_not_supported" | "seed_required" | "unsupported_runtime_operation",
    message: string
  ) {
    super(message);
    this.name = "PersistenceError";
  }
}
