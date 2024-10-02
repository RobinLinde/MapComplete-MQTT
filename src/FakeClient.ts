import { IClientPublishOptions } from "async-mqtt"
import { Logger } from "winston"

export default class FakeClient {
  logger: Logger

  constructor(logger: Logger) {
    this.logger = logger
  }

  public publish(
    topic: string,
    message: string | Buffer,
    opts?: IClientPublishOptions
  ): Promise<void> {
    this.logger.debug(`FakeClient.publish(${topic}, ${message}, ${JSON.stringify(opts)})`)
    return Promise.resolve()
  }
}
