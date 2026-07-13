// Typed service-layer errors. Services throw these instead of a plain Error so
// the REST router can translate them into the correct HTTP status (404/403)
// without resorting to string matching on the error message.

export class NotFoundError extends Error {
  constructor(message = "Not found") {
    super(message);
    this.name = "NotFoundError";
  }
}

export class ForbiddenError extends Error {
  constructor(message = "Forbidden") {
    super(message);
    this.name = "ForbiddenError";
  }
}
