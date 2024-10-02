import * as dotenv from "dotenv"
import { AsyncMqttClient, connectAsync } from "async-mqtt"
import type { Changeset } from "./@types/OSMCha"
import { createLogger, transports, format } from "winston"
import FakeClient from "./FakeClient"
import { ExtendedTheme } from "./@types/MapComplete"
import { HomeAssistant } from "./HomeAssistant"
import { OsmCha } from "./OsmCha"
import { MapComplete, Statistics } from "./MapComplete"

// Standard variables
dotenv.config()
const mqtt_host = process.env.MQTT_HOST || "localhost"
const mqtt_port = process.env.MQTT_PORT ? parseInt(process.env.MQTT_PORT) : 1883
const mqtt_username = process.env.MQTT_USERNAME || ""
const mqtt_password = process.env.MQTT_PASSWORD || ""
const dry_run = process.env.DRY_RUN === "True" || false
const debug = process.env.DEBUG === "True" || false
const update_interval = process.env.UPDATE_INTERVAL ? parseInt(process.env.UPDATE_INTERVAL) : 5 * 60

// Create a logger
const logger = createLogger({
  transports: [
    new transports.Console({
      format: format.combine(
        format.timestamp(),
        format.printf((info) => `${info.timestamp} ${info.level}: ${info.message} ()`),
        format.colorize({ all: true })
      ),
    }),
    new transports.File({
      filename: "mapcomplete-stats.log",
    }),
  ],
  level: debug ? "debug" : "info",
})

// Check if the OSMCha token is set
if (process.env.OSMCHA_TOKEN === undefined) {
  logger.error("OSMCHA_TOKEN is not set")
  process.exit(1)
}

// Variables for storing the changesets
let lastUpdateTime = new Date().setHours(0, 0, 0, 0)
let mapCompleteChangesets: Changeset[] = []
const mapCompleteThemes: ExtendedTheme[] = []

// Preparation for some helpers
let homeAssistant: HomeAssistant
const osmCha = new OsmCha(process.env.OSMCHA_TOKEN, logger)
const mapComplete = new MapComplete(mapCompleteThemes, logger)

// Configure timezone to UTC
process.env.TZ = "UTC"

/**
 * Main loop connecting to MQTT and performing the update
 */
async function main() {
  // Create a (fake) client
  let client: AsyncMqttClient | FakeClient
  if (!dry_run) {
    client = await connectAsync({
      host: mqtt_host,
      port: mqtt_port,
      username: mqtt_username,
      password: mqtt_password,
    })
  } else {
    client = new FakeClient(logger)
  }

  // Create a HomeAssistant instance
  homeAssistant = new HomeAssistant(client, logger)

  // Perform initial update
  await update(client)

  // Publish the configuration
  await homeAssistant.publishSensorConfig()

  if (!dry_run) {
    // Create a loop to send a message for every update_interval
    setInterval(async () => update(client), 1000 * update_interval)
  } else {
    logger.info("Dry run, not creating interval, exiting")
    // Wait 5 seconds before exiting
    setTimeout(() => process.exit(0), 5000)
  }
}

/**
 * Function to update the changesets and publish the data to MQTT
 *
 * @param client The MQTT client to publish the data to
 */
async function update(client: AsyncMqttClient | FakeClient) {
  let newDay = false
  logger.info("Performing update")
  // Check if the last update time is still today
  if (new Date(lastUpdateTime).getDate() !== new Date().getDate()) {
    logger.info("New day, resetting changesets")
    // Reset the mapCompleteChangesets array
    mapCompleteChangesets = []
    // Reset the lastUpdateTime
    lastUpdateTime = new Date().setHours(0, 0, 0, 0)

    // Set newDay to true, so we can clean up sensors we have no data for yet/any more
    newDay = true
  }

  // Get date in YYYY-MM-DD HH:MM:SS format, minus 10 minutes to account for delays, unless this means we go back to yesterday
  let date = new Date(lastUpdateTime - 1000 * 60 * 10).getTime()

  if (date < new Date().setHours(0, 0, 0, 0)) {
    date = new Date().setHours(0, 0, 0, 0)
  }

  const dateStr = new Date(date).toISOString().slice(0, 19).replace("T", " ")

  logger.info(`Getting changesets since ${dateStr}`)

  // Wrap the update in a try/catch block, so we can catch errors
  try {
    const changesets = await osmCha.getChangesets(dateStr)

    // Loop through the changesets
    for (const changeset of changesets) {
      // Check if the changeset is already in the array
      if (mapCompleteChangesets.find((c) => c.id === changeset.id)) {
        // Skip this changeset
        continue
      }

      // Add the changeset to the array
      mapCompleteChangesets.push(changeset)
    }

    // Sort the changesets by ID
    mapCompleteChangesets.sort((a, b) => a.id - b.id)

    // Get the statistics
    const statistics = await mapComplete.getStatistics(mapCompleteChangesets)

    // Log the statistics
    logger.info(
      `Total changesets for today: ${statistics.changesets.total} by ${statistics.users.total} users, using ${statistics.themes.total} different themes`
    )
    logger.info(
      `Top 5 users: ${Object.entries(statistics.users.users)
        .slice(0, 5)
        .map(([user, count]) => `${user} (${count})`)
        .join(", ")}`
    )
    logger.info(
      `Top 5 themes: ${Object.entries(statistics.themes.themes)
        .slice(0, 5)
        .map(([theme, count]) => `${theme} (${count})`)
        .join(", ")}`
    )
    logger.info(
      `Total questions answered: ${statistics.questions}, total images added: ${statistics.images}, total points added: ${statistics.points}`
    )

    // Publish the statistics
    await publishStatistics(client, statistics)

    // Publish the theme data
    await publishThemeData(client, statistics.themes.themes)

    // Publish the theme sensors
    await homeAssistant.publishThemeSensorConfig(mapCompleteThemes)

    // Update the lastChangesetTime
    lastUpdateTime = new Date().getTime()
  } catch (error) {
    logger.error("Error while updating statistics", error)
  }

  // Clean up sensors for themes we don't have data for yet/any more
  if (newDay) {
    await homeAssistant.cleanUpSensors(mapCompleteThemes, mapCompleteChangesets)
  }
}

/**
 * Function to publish overall statistics to MQTT
 *
 * @param client MQTT client or FakeClient
 * @param statistics Statistics object
 */
async function publishStatistics(client: AsyncMqttClient | FakeClient, statistics: Statistics) {
  // Publish the statistics to MQTT
  logger.info("Publishing statistics to MQTT")
  await client.publish("mapcomplete/statistics", JSON.stringify(statistics), {
    retain: true,
  })

  // Also publish everything to its own topic
  for (const [key, value] of Object.entries(statistics)) {
    // Handle nested objects
    if (typeof value === "object") {
      for (const [subKey, subValue] of Object.entries(value)) {
        await client.publish(`mapcomplete/statistics/${key}/${subKey}`, JSON.stringify(subValue), {
          retain: true,
        })
      }
      // Also publish the whole object
      await client.publish(`mapcomplete/statistics/${key}`, JSON.stringify(value), {
        retain: true,
      })
    } else if (typeof value === "number") {
      await client.publish(`mapcomplete/statistics/${key}`, value.toString(), {
        retain: true,
      })
    } else if (typeof value === "string") {
      await client.publish(`mapcomplete/statistics/${key}`, value, {
        retain: true,
      })
    } else {
      await client.publish(`mapcomplete/statistics/${key}`, JSON.stringify(value), {
        retain: true,
      })
    }
  }
}

/**
 * Function to publish data for individual theme sensors
 *
 * @param client MQTT client or FakeClient
 */
async function publishThemeData(
  client: AsyncMqttClient | FakeClient,
  themes: Record<string, number>
) {
  // Loop through the themes
  for (const theme of Object.keys(themes)) {
    // Get the rest of the statistics for this theme
    const themeStatistics = await mapComplete.getThemeStatistics(mapCompleteChangesets, theme)

    // Publish the data for the theme
    await client.publish(`mapcomplete/statistics/theme/${theme}`, JSON.stringify(themeStatistics), {
      retain: true,
    })

    // Also everything to its own topic
    for (const [key, value] of Object.entries(themeStatistics)) {
      // Handle nested objects
      if (typeof value === "object") {
        for (const [subKey, subValue] of Object.entries(value)) {
          await client.publish(
            `mapcomplete/statistics/theme/${theme}/${key}/${subKey}`,
            JSON.stringify(subValue),
            {
              retain: true,
            }
          )
        }
        // Also publish the whole object
        await client.publish(
          `mapcomplete/statistics/theme/${theme}/${key}`,
          JSON.stringify(value),
          {
            retain: true,
          }
        )
      } else if (typeof value === "number") {
        await client.publish(`mapcomplete/statistics/theme/${theme}/${key}`, value.toString(), {
          retain: true,
        })
      } else if (typeof value === "string") {
        await client.publish(`mapcomplete/statistics/theme/${theme}/${key}`, value, {
          retain: true,
        })
      } else {
        await client.publish(
          `mapcomplete/statistics/theme/${theme}/${key}`,
          JSON.stringify(value),
          {
            retain: true,
          }
        )
      }
    }

    // Also publish the icon for the theme
    const themeDetails = mapCompleteThemes.find((t) => t.id === theme)
    if (themeDetails) {
      await client.publish(`mapcomplete/statistics/theme/${theme}/icon`, themeDetails.icon, {
        retain: true,
      })
    }
  }
}

main()
