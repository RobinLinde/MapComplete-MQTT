import { IClientPublishOptions } from "async-mqtt"
import { Logger } from "winston"

interface JsonMqttData {
  topic: string
  message?: string
  children?: JsonMqttData[]
}

export default class FakeClient {
  logger: Logger
  data: JsonMqttData

  constructor(logger: Logger) {
    this.logger = logger
    this.data = {
      topic: "example.com",
      children: [],
    }
  }

  private saveMessage(topic: string, message: string | Buffer) {
    this.logger.debug(`FakeClient.saveMessage(${topic}, ${message})`)
    const parts = topic.split("/")
    let current = this.data
    for (const part of parts) {
      let child = current.children.find((c) => c.topic === part)
      if (!child) {
        child = { topic: part, children: [] }
        current.children.push(child)
      }
      current = child
    }
    current.message = message.toString()
  }

  public publish(
    topic: string,
    message: string | Buffer,
    opts?: IClientPublishOptions
  ): Promise<void> {
    this.logger.debug(`FakeClient.publish(${topic}, ${message}, ${JSON.stringify(opts)})`)
    // Also save it to the data object
    this.saveMessage(topic, message)
    return Promise.resolve()
  }
}
