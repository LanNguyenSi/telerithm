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

/**
 * Thrown for a delivery that fails on the caller's own configuration (the URL
 * guard refused the target, or the channel has no URL configured). Its message
 * describes that configuration, so a route may show it to the caller; every
 * other send failure describes the remote host or the network path to it.
 */
export class ChannelConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChannelConfigError";
  }
}
