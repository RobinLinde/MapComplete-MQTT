import { IClientPublishOptions, ISubscriptionGrant } from "async-mqtt";
import { Logger } from "winston";

interface JsonMqttData {
  topic: string;
  message?: string;
  children?: JsonMqttData[];
}

export default class FakeClient {
  logger: Logger;
  data: JsonMqttData;
  subscriptions: string[] = [];

  constructor(logger: Logger) {
    this.logger = logger;
    this.data = {
      topic: "example.com",
      children: [],
    };
  }

  private saveMessage(topic: string, message: string | Buffer) {
    this.logger.debug(`FakeClient.saveMessage(${topic}, ${message})`);
    const parts = topic.split("/");
    let current = this.data;
    for (const part of parts) {
      let child = current.children.find((c) => c.topic === part);
      if (!child) {
        child = { topic: part, children: [] };
        current.children.push(child);
      }
      current = child;
    }
    if (!current.message) {
      this.logger.warn(
        `FakeClient.saveMessage(${topic}, ${message}) - message is undefined, overwriting with an empty string`
      );
      current.message = "";
    } else {
      current.message = message.toString();
    }
  }

  public publish(
    topic: string,
    message: string | Buffer,
    opts?: IClientPublishOptions
  ): Promise<void> {
    this.logger.debug(
      `FakeClient.publish(${topic}, ${message}, ${JSON.stringify(opts)})`
    );
    // Also save it to the data object
    this.saveMessage(topic, message);
    return Promise.resolve();
  }

  public subscribe(topic: string): Promise<ISubscriptionGrant[]> {
    this.logger.debug(`FakeClient.subscribe(${topic})`);
    this.subscriptions.push(topic);
    return Promise.resolve([]);
  }

  public unsubscribe(topic: string): Promise<void> {
    this.logger.debug(`FakeClient.unsubscribe(${topic})`);
    this.subscriptions = this.subscriptions.filter((t) => t !== topic);
    return Promise.resolve();
  }

  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
  public on(event: string, _cb: Function): this {
    this.logger.debug(`FakeClient.on(${event})`);
    return this;
  }
}
