import { Logger } from "winston"
import { APIResponse, Changeset } from "./@types/OSMCha"

/**
 * Class for interacting with OSMCha
 */
export class OsmCha {
  osmcha_token: string
  logger: Logger

  constructor(osmcha_token: string, logger: Logger) {
    this.osmcha_token = osmcha_token
    this.logger = logger
  }

  public async getChangesets(startDate: string, limit: number = 100): Promise<Changeset[]> {
    try {
      // Get the changesets from OSMCha
      const response = await fetch(
        `https://osmcha.org/api/v1/changesets/?page_size=${limit}&date__gte=${encodeURIComponent(
          startDate
        )}&editor=MapComplete`,
        {
          headers: {
            accept: "application/json",
            Authorization: process.env.OSMCHA_TOKEN,
          },
        }
      )

      //Parse the response
      const data: APIResponse = await response.json()
      this.logger.info(`Found ${data.features.length} new changesets`)

      return data.features
    } catch (e) {
      this.logger.error(`Error fetching changesets from OSMCha: ${e}`)
      return []
    }
  }
}
