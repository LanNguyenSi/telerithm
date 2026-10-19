/**
 * Thrown by a channel sender when the remote target answered with a non-2xx
 * status. The status and status text describe a third-party host, so they are
 * for server-side logging only; a route that reports a send failure to the
 * caller must map this class to a generic message.
 */
export class ChannelHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly statusText: string,
  ) {
    super(message);
    this.name = "ChannelHttpError";
  }
}
