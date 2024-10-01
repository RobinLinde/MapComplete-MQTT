import * as dotenv from "dotenv"
import { AsyncMqttClient, connectAsync } from "async-mqtt"
import type { APIResponse, Changeset } from "./@types/OSMCha"
import { createLogger, transports, format } from "winston"
import FakeClient from "./FakeClient"
import { ExtendedTheme, Theme } from "./@types/MapComplete"
import { getAverageColor } from "fast-average-color-node"

// Standard variables
dotenv.config()
const mqtt_host = process.env.MQTT_HOST || "localhost"
const mqtt_port = process.env.MQTT_PORT ? parseInt(process.env.MQTT_PORT) : 1883
const mqtt_username = process.env.MQTT_USERNAME || ""
const mqtt_password = process.env.MQTT_PASSWORD || ""
const dry_run = process.env.DRY_RUN === "True" || false
const update_interval = process.env.UPDATE_INTERVAL ? parseInt(process.env.UPDATE_INTERVAL) : 5 * 60

// Import version from package.json
const packageJson = require("../package.json")
const version = packageJson.version

// Create a logger
const logger = createLogger({
  transports: [
    new transports.Console({
      format: format.combine(
        format.timestamp(),
        format.printf((info) => `${info.timestamp} ${info.level}: ${info.message}`),
        format.colorize({ all: true })
      ),
    }),
    new transports.File({
      filename: "mapcomplete-stats.log",
    }),
  ],
  level: "info",
})

// Configure timezone to UTC
process.env.TZ = "UTC"

// Lookup table
const themeColors = {
  default: "#70c549",
  advertising: "#fffe73",
  aed: "#008855",
  benches: "#896847",
  cycle_infra: "#f7d728",
  cyclofix: "#e2783d",
  drinking_water: "#66bef3",
  grb: "#ffe615",
  maxspeed: "#e41408",
  natuurpunt: "#93bb0f",
  onwheels: "#22ca60",
  personal: "#37d649",
  postboxes: "#ff6242",
  toerisme_vlaanderen: "#038003",
  trees: "#008000",
}

// Variables for storing the changesets
let lastUpdateTime = new Date().setHours(0, 0, 0, 0)
let mapCompleteChangesets: Changeset[] = []
let mapCompleteThemes: ExtendedTheme[] = []

/**
 * Create a device that will be used for all sensors
 */
const device = {
  name: "MapComplete",
  identifiers: ["mapcomplete"],
  sw_version: version,
  model: "MapComplete Statistics",
  manufacturer: "MapComplete MQTT",
}

// Check if the OSMCha token is set
if (process.env.OSMCHA_TOKEN === undefined) {
  logger.error("OSMCHA_TOKEN is not set")
  process.exit(1)
}

/**
 * Main loop connecting to MQTT and performing the update
 */
async function main() {
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

  // Perform initial update
  await update(client)

  // Publish the configuration
  await publishConfig(client)

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
 * Function to convert a hex color code to an RGB color code
 *
 * @param hex Hex color code
 * @returns RGB color code
 */
function hexToRgb(hex: string): [number, number, number] {
  const bigint = parseInt(hex.replace("#", ""), 16)
  const r = (bigint >> 16) & 255
  const g = (bigint >> 8) & 255
  const b = bigint & 255

  return [r, g, b]
}

/**
 * Small function to find the top value in an object
 *
 * @param item The object to find the top value in
 * @returns The key or keys with the highest value
 */
function findTop(item: Record<string, number>): string {
  // Get the highest value
  const highest = Math.max(...Object.values(item))
  // Get the key or keys with the highest value
  const keys = Object.keys(item).filter((k) => item[k] === highest)

  // Return the key or keys with the highest value
  return keys.length === 1 ? keys[0] : keys.join(", ")
}

/**
 * Function to update the changesets and publish the data to MQTT
 *
 * @param client The MQTT client to publish the data to
 */
async function update(client: AsyncMqttClient | FakeClient) {
  logger.info("Performing update")
  // Check if the last update time is still today
  if (new Date(lastUpdateTime).getDate() !== new Date().getDate()) {
    logger.info("New day, resetting changesets")
    // Reset the mapCompleteChangesets array
    mapCompleteChangesets = []
    // Reset the lastUpdateTime
    lastUpdateTime = new Date().setHours(0, 0, 0, 0)
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
    // Get the changesets from OSMCha
    const response = await fetch(
      `https://osmcha.org/api/v1/changesets/?page_size=100&date__gte=${encodeURIComponent(
        dateStr
      )}&editor=MapComplete`,
      {
        headers: {
          accept: "application/json",
          Authorization: process.env.OSMCHA_TOKEN,
        },
      }
    )

    // Parse the response
    const data: APIResponse = await response.json()

    logger.info(`Found ${data.features.length} new changesets`)

    // Loop through the changesets
    for (const changeset of data.features) {
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

    // Determine all statistics

    // Total number of changesets
    const total = mapCompleteChangesets.length

    // Unique users
    const userCount = new Set(mapCompleteChangesets.map((c) => c.properties.uid)).size

    // Users
    let users = mapCompleteChangesets.reduce((acc, cur) => {
      // If the user is not in the object, add it
      if (acc[cur.properties.user] === undefined) {
        acc[cur.properties.user] = 0
      }
      // Increase the count for the user
      acc[cur.properties.user]++
      return acc
    }, {} as Record<string, number>)
    // Sort the users by the number of changesets
    users = Object.fromEntries(Object.entries(users).sort(([, a], [, b]) => b - a))

    // Unique themes
    const themeCount = new Set(mapCompleteChangesets.map((c) => c.properties.metadata["theme"]))
      .size

    // Themes
    let themes = mapCompleteChangesets.reduce((acc, cur) => {
      // Get the theme from the changeset
      const theme = cur.properties.metadata["theme"]
      // If the theme is not in the object, add it
      if (acc[theme] === undefined) {
        acc[theme] = 0
      }
      // Increase the count for the theme
      acc[theme]++
      return acc
    }, {} as Record<string, number>)
    // Sort the themes by the number of changesets
    themes = Object.fromEntries(Object.entries(themes).sort(([, a], [, b]) => b - a))

    // Make a list of colors for each changeset
    const colors: string[] = []

    // Loop through the changesets
    for (const changeset of mapCompleteChangesets) {
      // Get the details for the changeset
      try {
        const themeDetails = await getThemeDetails(changeset)
        // Add the color to the array
        colors.push(themeDetails.color)
        // Add the theme to the list of themes, if it is not already there
        if (!mapCompleteThemes.find((t) => t.id === changeset.properties.metadata["theme"])) {
          mapCompleteThemes.push({
            id: changeset.properties.metadata["theme"],
            title: themeDetails.name,
            icon: themeDetails.icon,
            published: false,
            color: themeDetails.color,
          })
        }
      } catch (e) {
        // console.error(e, "Error while getting theme details", changeset)
        logger.error(e, "Error while getting theme details")
        continue
      }
    }

    // Total number of answered questions of all changesets
    const questions = mapCompleteChangesets.reduce((acc, cur) => {
      // Check if the changeset has the answer metadata
      if (cur.properties.metadata["answer"] === undefined) {
        // Skip this changeset
        return acc
      }
      // Get the number of answered questions from the changeset
      const changesetQuestions = parseInt(cur.properties.metadata["answer"])
      // Add the number of answered questions to the total
      return acc + changesetQuestions
    }, 0)

    // Total number of added images of all changesets
    const images = mapCompleteChangesets.reduce((acc, cur) => {
      // Check if the changeset has the image metadata
      if (cur.properties.metadata["add-image"] === undefined) {
        // Skip this changeset
        return acc
      }
      // Get the number of added images from the changeset
      const changesetImages = parseInt(cur.properties.metadata["add-image"])
      // Add the number of added images to the total
      return acc + changesetImages
    }, 0)

    // Total number of added points of all changesets
    const points = mapCompleteChangesets.reduce((acc, cur) => {
      // Check if the changeset has the create metadata
      if (cur.properties.metadata["create"] === undefined) {
        // Skip this changeset
        return acc
      }
      // Get the number of added points from the changeset
      const changesetPoints = parseInt(cur.properties.metadata["create"])
      // Add the number of added points to the total
      return acc + changesetPoints
    }, 0)

    let lastId: number | null
    let lastUser: string | null
    let lastTheme: string | null
    let lastColor: string
    let lastColorRgb: [number, number, number] | null

    // Check if we actually have any changesets before we try to get the last changeset
    if (mapCompleteChangesets.length > 0) {
      // Get the last changeset
      const lastChangeset = mapCompleteChangesets[mapCompleteChangesets.length - 1]
      // Get the last changeset ID
      lastId = lastChangeset.id
      // Get the last changeset user
      lastUser = lastChangeset.properties.user
      // Get the last changeset theme
      lastTheme = lastChangeset.properties.metadata["theme"]
      // Get the last changeset color
      lastColor = colors[colors.length - 1]
      lastColorRgb = hexToRgb(lastColor)
    } else {
      // Set the last changeset ID to null
      lastId = null
      // Set the last changeset user to null
      lastUser = null
      // Set the last changeset theme to null
      lastTheme = null
      // Set the last changeset color to null
      lastColor = null
      lastColorRgb = null
    }

    const statistics = {
      changesets: {
        total,
        last: lastId,
        lastUrl: `https://osm.org/changeset/${lastId}`,
        lastColor,
        lastColorRgb,
        colors,
        colorsStr: colors.join(","),
        colorsRgb: colors.map((c) => hexToRgb(c)),
        colorsRgbStr: colors.map((c) => hexToRgb(c)).join(","),
        changesets: mapCompleteChangesets.map((c) => ({
          id: c.id,
          user: c.properties.user,
          theme: c.properties.metadata["theme"],
          color: colors[mapCompleteChangesets.indexOf(c)],
          colorRgb: hexToRgb(colors[mapCompleteChangesets.indexOf(c)]),
          url: `https://osm.org/changeset/${c.id}`,
        })),
      },
      users: {
        total: userCount,
        top: findTop(users),
        last: lastUser,
        users,
      },
      themes: {
        total: themeCount,
        top: findTop(themes),
        last: lastTheme,
        themes,
      },
      questions,
      images,
      points,
    }

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

    if (!dry_run) {
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
            await client.publish(
              `mapcomplete/statistics/${key}/${subKey}`,
              JSON.stringify(subValue),
              {
                retain: true,
              }
            )
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

      // Publish the theme data
      await publishThemeData(client, themes)
    } else {
      logger.info("Dry run, not publishing statistics to MQTT", statistics)
    }

    // Publish the theme sensors
    await publishThemeConfig(client)

    // Update the lastChangesetTime
    lastUpdateTime = new Date().getTime()
  } catch (error) {
    logger.error("Error while updating statistics", error)
  }
}

/**
 * Function to publish Home Assistant configuration to MQTT
 *
 * @param client MQTT client
 */
async function publishConfig(client: AsyncMqttClient | FakeClient) {
  /**
   * Mapping of all payloads for each sensor to their respective topics
   */
  const sensors = {
    "homeassistant/sensor/mapcomplete/totalChangesets/config": {
      name: "Changesets Today",
      unit_of_measurement: "changesets",
      state_topic: "mapcomplete/statistics/changesets/total",
      icon: "mdi:map-marker",
      unique_id: "mapcomplete_changesets_total",
      json_attributes_topic: "mapcomplete/statistics/changesets",
      device: device,
    },
    "homeassistant/sensor/mapcomplete/lastChangeset/config": {
      name: "Last Changeset",
      state_topic: "mapcomplete/statistics/changesets/last",
      icon: "mdi:map-marker",
      unique_id: "mapcomplete_changesets_last",
      enabled_by_default: false,
      device: device,
    },
    "homeassistant/sensor/mapcomplete/lastChangesetColor/config": {
      name: "Last Changeset Color",
      state_topic: "mapcomplete/statistics",
      icon: "mdi:palette",
      unique_id: "mapcomplete_changesets_last_color",
      enabled_by_default: false,
      value_template: "{{ value_json.changesets.lastColor }}",
      device: device,
    },
    "homeassistant/sensor/mapcomplete/lastChangesetColorRgb/config": {
      name: "Last Changeset Color RGB",
      state_topic: "mapcomplete/statistics",
      icon: "mdi:palette",
      unique_id: "mapcomplete_changesets_last_color_rgb",
      enabled_by_default: false,
      value_template: "{{ value_json.changesets.lastColorRgb }}",
      device: device,
    },
    "homeassistant/sensor/mapcomplete/totalUsers/config": {
      name: "Users Today",
      unit_of_measurement: "users",
      state_topic: "mapcomplete/statistics/users/total",
      icon: "mdi:account",
      unique_id: "mapcomplete_users_total",
      json_attributes_topic: "mapcomplete/statistics/users/users",
      device: device,
    },
    "homeassistant/sensor/mapcomplete/lastUser/config": {
      name: "Last User",
      state_topic: "mapcomplete/statistics",
      icon: "mdi:account",
      unique_id: "mapcomplete_users_last",
      value_template: "{{ value_json.users.last }}",
      device: device,
    },
    "homeassistant/sensor/mapcomplete/topUser/config": {
      name: "Top User(s)",
      state_topic: "mapcomplete/statistics",
      icon: "mdi:account",
      unique_id: "mapcomplete_users_top",
      value_template: "{{ value_json.users.top }}",
      device: device,
    },
    "homeassistant/sensor/mapcomplete/totalThemes/config": {
      name: "Themes Used Today",
      unit_of_measurement: "themes",
      state_topic: "mapcomplete/statistics/themes/total",
      icon: "mdi:palette",
      unique_id: "mapcomplete_themes_total",
      json_attributes_topic: "mapcomplete/statistics/themes/themes",
      device: device,
    },
    "homeassistant/sensor/mapcomplete/lastTheme/config": {
      name: "Last Theme",
      state_topic: "mapcomplete/statistics",
      icon: "mdi:palette",
      unique_id: "mapcomplete_themes_last",
      value_template: "{{ value_json.themes.last }}",
      device: device,
    },
    "homeassistant/sensor/mapcomplete/topTheme/config": {
      name: "Top Theme(s)",
      state_topic: "mapcomplete/statistics",
      icon: "mdi:palette",
      unique_id: "mapcomplete_themes_top",
      value_template: "{{ value_json.themes.top }}",
      device: device,
    },
    "homeassistant/sensor/mapcomplete/totalQuestions/config": {
      name: "Questions Answered Today",
      unit_of_measurement: "questions",
      state_topic: "mapcomplete/statistics/questions",
      icon: "mdi:comment-question",
      unique_id: "mapcomplete_questions_total",
      device: device,
    },
    "homeassistant/sensor/mapcomplete/totalImages/config": {
      name: "Images Added Today",
      unit_of_measurement: "images",
      state_topic: "mapcomplete/statistics/images",
      icon: "mdi:image",
      unique_id: "mapcomplete_images_total",
      device: device,
    },
    "homeassistant/sensor/mapcomplete/totalPoints/config": {
      name: "Points Added Today",
      unit_of_measurement: "points",
      state_topic: "mapcomplete/statistics/points",
      icon: "mdi:map-marker",
      unique_id: "mapcomplete_points_total",
      device: device,
    },
  }

  // Publish the configuration for each sensor
  logger.info("Publishing sensor configuration to MQTT")
  for (const [topic, payload] of Object.entries(sensors)) {
    if (!dry_run) {
      await client.publish(topic, JSON.stringify(payload), {
        retain: true,
      })
    } else {
      logger.info("Dry run, not publishing sensor configuration to MQTT", topic, payload)
    }
  }
}

/**
 * This function gets the theme color and some other information from the theme used in a changeset
 *
 * @param changeset Changeset to get information from
 * @returns
 */
async function getThemeDetails(changeset: Changeset): Promise<{
  color: string
  icon: string
  name: string
}> {
  const theme = changeset.properties.metadata["theme"]
  const host = changeset.properties.metadata["host"]

  // First check if we already have details for this theme
  if (mapCompleteThemes.find((t) => t.id === theme)) {
    // We already have all details for this theme, return it
    const themeDetails = mapCompleteThemes.find((t) => t.id === theme)
    return {
      color: themeDetails.color,
      icon: themeDetails.icon,
      name: themeDetails.title,
    }
  } else {
    // We'll need to download the theme file, find the image and extract the color
    let url
    let baseUrl

    if (
      host.startsWith("https://mapcomplete.osm.be/") ||
      host.startsWith("https://mapcomplete.org/")
    ) {
      baseUrl = "https://raw.githubusercontent.com/pietervdvn/MapComplete/master"
      url = `${baseUrl}/assets/themes/${theme}/${theme}.json`
    } else if (host.startsWith("https://pietervdvn.github.io/mc/")) {
      // We'll need to parse the branch from the url
      // Example: https://pietervdvn.github.io/mc/feature/maplibre/index.html
      // Result: feature/maplibre

      const parts = host.split("/").slice(4, -1)
      const branch = parts.join("/")

      baseUrl = `https://raw.githubusercontent.com/pietervdvn/MapComplete/${branch}`
      url = `${baseUrl}/assets/themes/${theme}/${theme}.json`
    } else {
      // Return a default color
      logger.info(`No theme file found for ${theme} on ${host}, returning default information`)
      return {
        color: themeColors["default"],
        icon: "https://raw.githubusercontent.com/pietervdvn/MapComplete/refs/heads/develop/assets/svg/add.svg",
        name: theme,
      }
    }

    // Override the url if the theme is a full url
    if (theme.startsWith("https://")) {
      // Unofficial theme, we'll need to download it from the url
      url = theme
    }

    // logger.info(`Downloading theme file from ${url}`);
    const themeFile = await fetch(url)
    const themeJson: Theme = await themeFile.json()

    let color: string

    // Determine image URL
    let image = themeJson.icon

    // If the image URL is relative, prepend the host from the url
    if (image.startsWith(".")) {
      image = `${baseUrl}/${image.slice(2)}`
    }

    // Check if we already have a predefined color for this theme
    if (themeColors[theme]) {
      color = themeColors[theme]
    } else {
      // We need to analyze the image to get the color

      logger.info(`Downloading theme image for ${theme} from ${image}`)
      try {
        // Download the image
        const imageFile = await fetch(image)
        // Convert the image to an array buffer
        const imageArrayBuffer = await imageFile.arrayBuffer()
        // Convert array buffer to a buffer
        const imageBuffer = Buffer.from(imageArrayBuffer)

        const dominantColor = await getAverageColor(imageBuffer)

        // Convert the color to a hex string
        color = dominantColor.hex

        // If it is dark, use the default color
        if (dominantColor.isDark) {
          color = themeColors["default"]
        }
      } catch (e) {
        logger.error(`Failed to get color for ${theme} from ${image}, using default`, e)
        color = themeColors["default"]
      }

      logger.debug("Theme details", theme, color, image, determineTitle(themeJson.title))
    }

    // Return the details
    return {
      color,
      icon: image,
      name: determineTitle(themeJson.title),
    }
  }
}

/**
 * Small helper function to determine the title of a theme
 *
 * @param title Title object or string
 * @returns String containing the title
 */
function determineTitle(title: any): string {
  // Check if the title is an object
  if (typeof title === "object") {
    // Check if the object has an en key
    if (title.en) {
      // Return the en key
      return title.en
    } else {
      // Return the first key
      return title[Object.keys(title)[0]]
    }
  } else {
    // Return the title as is
    return title
  }
}

/**
 * Function that publishes sensors for all not yet published themes
 *
 * @param client MQTT client or FakeClient
 */
async function publishThemeConfig(client: AsyncMqttClient | FakeClient) {
  // Loop through the themes
  for (const theme of mapCompleteThemes) {
    // Check if we have already published the theme
    if (!theme.published) {
      // We need to create some sensors for this theme
      const changesetsSensor = {
        name: "Changesets Today",
        state_topic: `mapcomplete/statistics/theme/${theme.id}`,
        entity_picture: theme.icon,
        unit_of_measurement: "changesets",
        unique_id: `mapcomplete_theme_${theme.id}_changesets`,
        device: {
          name: theme.title,
          identifiers: [`mapcomplete_theme_${theme.id}`],
          sw_version: version,
          model: "MapComplete Statistics",
          manufacturer: "MapComplete MQTT",
        },
      }
      const iconImage = {
        name: "Icon",
        url_topic: `mapcomplete/statistics/theme/${theme.id}/icon`,
        entity_picture: theme.icon,
        unique_id: `mapcomplete_theme_${theme.id}_icon`,
        device: {
          name: theme.title,
          identifiers: [`mapcomplete_theme_${theme.id}`],
          sw_version: version,
          model: "MapComplete Statistics",
          manufacturer: "MapComplete MQTT",
        },
      }
      const usersSensor = {
        name: "Users Today",
        state_topic: `mapcomplete/statistics/theme/${theme.id}/totalUsers`,
        json_attributes_topic: `mapcomplete/statistics/theme/${theme.id}/users`,
        unique_id: `mapcomplete_theme_${theme.id}_users`,
        device: {
          name: theme.title,
          identifiers: [`mapcomplete_theme_${theme.id}`],
          sw_version: version,
          model: "MapComplete Statistics",
          manufacturer: "MapComplete MQTT",
        },
      }
      const topUserSensor = {
        name: "Top User",
        state_topic: `mapcomplete/statistics/theme/${theme.id}/topUser`,
        unique_id: `mapcomplete_theme_${theme.id}_top_user`,
        device: {
          name: theme.title,
          identifiers: [`mapcomplete_theme_${theme.id}`],
          sw_version: version,
          model: "MapComplete Statistics",
          manufacturer: "MapComplete MQTT",
        },
      }

      if (!dry_run) {
        // Publish the sensor configuration
        logger.info(`Publishing sensor configuration for ${theme.title}`)
        await client.publish(
          `homeassistant/sensor/mapcomplete/theme_${theme.id}_changesets/config`,
          JSON.stringify(changesetsSensor),
          {
            retain: true,
          }
        )

        await client.publish(
          `homeassistant/image/mapcomplete/theme_${theme.id}_icon/config`,
          JSON.stringify(iconImage),
          {
            retain: true,
          }
        )

        await client.publish(
          `homeassistant/sensor/mapcomplete/theme_${theme.id}_users/config`,
          JSON.stringify(usersSensor),
          {
            retain: true,
          }
        )

        await client.publish(
          `homeassistant/sensor/mapcomplete/theme_${theme.id}_top_user/config`,
          JSON.stringify(topUserSensor),
          {
            retain: true,
          }
        )

        // Mark the theme as published
        theme.published = true
      } else logger.info("Dry run, not publishing sensor configuration for theme", theme.title)
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
  for (const [theme, count] of Object.entries(themes)) {
    // Publish the data for the theme sensor
    if (!dry_run) {
      await client.publish(`mapcomplete/statistics/theme/${theme}`, count.toString(), {
        retain: true,
      })

      // Also publish the icon for the theme
      const themeDetails = mapCompleteThemes.find((t) => t.id === theme)
      if (themeDetails) {
        await client.publish(`mapcomplete/statistics/theme/${theme}/icon`, themeDetails.icon, {
          retain: true,
        })
      }

      // Publish amount of users for this theme
      const users = mapCompleteChangesets.reduce((acc, cur) => {
        // Get the theme from the changeset
        const themeId = cur.properties.metadata["theme"]
        // If the theme is not the one we're looking for, skip
        if (themeId !== theme) {
          return acc
        }
        // Get the user from the changeset
        const user = cur.properties.user
        // If the user is not in the object, add it
        if (acc[user] === undefined) {
          acc[user] = 0
        }
        // Increase the count for the user
        acc[user]++
        return acc
      }, {} as Record<string, number>)
      // Sort the users by the number of changesets
      const sortedUsers = Object.fromEntries(Object.entries(users).sort(([, a], [, b]) => b - a))

      await client.publish(
        `mapcomplete/statistics/theme/${theme}/users`,
        JSON.stringify(sortedUsers),
        {
          retain: true,
        }
      )

      // Publish total users for this theme
      await client.publish(
        `mapcomplete/statistics/theme/${theme}/totalUsers`,
        Object.keys(users).length.toString(),
        {
          retain: true,
        }
      )

      // Publish top user for this theme
      await client.publish(`mapcomplete/statistics/theme/${theme}/topUser`, findTop(users), {
        retain: true,
      })
    } else {
      logger.info("Dry run, not publishing theme data to MQTT", theme, count)
    }
  }
}

main()
