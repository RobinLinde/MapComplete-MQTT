import * as dotenv from "dotenv";
import { AsyncMqttClient, connectAsync } from "async-mqtt";
import type { APIResponse, Changeset } from "./@types/OSMCha";
import { createLogger, transports, format } from "winston";
import FakeClient from "./FakeClient";
import { Theme } from "./@types/MapComplete";
import { getAverageColor } from "fast-average-color-node";

// Standard variables
dotenv.config();
const mqtt_host = process.env.MQTT_HOST || "localhost";
const mqtt_port = process.env.MQTT_PORT
  ? parseInt(process.env.MQTT_PORT)
  : 1883;
const mqtt_username = process.env.MQTT_USERNAME || "";
const mqtt_password = process.env.MQTT_PASSWORD || "";
const dry_run = process.env.DRY_RUN === "True" || false;
const update_interval = process.env.UPDATE_INTERVAL
  ? parseInt(process.env.UPDATE_INTERVAL)
  : 5 * 60;

// Create a logger
const logger = createLogger({
  transports: [
    new transports.Console({
      format: format.combine(
        format.timestamp(),
        format.printf(
          (info) => `${info.timestamp} ${info.level}: ${info.message}`
        ),
        format.colorize({ all: true })
      ),
    }),
    new transports.File({
      filename: "mapcomplete-stats.log",
    }),
  ],
  level: "info",
});

// Configure timezone to UTC
process.env.TZ = "UTC";

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
};

// Variables for storing the changesets
let lastUpdateTime = new Date().setHours(0, 0, 0, 0);
let mapCompleteChangesets: Changeset[] = [];

// Check if the OSMCha token is set
if (process.env.OSMCHA_TOKEN === undefined) {
  logger.error("OSMCHA_TOKEN is not set");
  process.exit(1);
}

/**
 * Main loop connecting to MQTT and performing the update
 */
async function main() {
  let client: AsyncMqttClient | FakeClient;
  if (!dry_run) {
    client = await connectAsync({
      host: mqtt_host,
      port: mqtt_port,
      username: mqtt_username,
      password: mqtt_password,
    });
  } else {
    client = new FakeClient(logger);
  }

  // Perform initial update
  await update(client);

  // Publish the configuration
  await publishConfig(client);

  if (!dry_run) {
    // Create a loop to send a message for every update_interval
    setInterval(async () => update(client), 1000 * update_interval);
  } else {
    logger.info("Dry run, not creating interval, exiting");
    // Wait 5 seconds before exiting
    setTimeout(() => process.exit(0), 5000);
  }
}

/**
 * Function to convert a hex color code to an RGB color code
 *
 * @param hex Hex color code
 * @returns RGB color code
 */
function hexToRgb(hex: string): [number, number, number] {
  const bigint = parseInt(hex.replace("#", ""), 16);
  const r = (bigint >> 16) & 255;
  const g = (bigint >> 8) & 255;
  const b = bigint & 255;

  return [r, g, b];
}

/**
 * Small function to find the top value in an object
 *
 * @param item The object to find the top value in
 * @returns The key or keys with the highest value
 */
function findTop(item: Record<string, number>): string {
  // Get the highest value
  const highest = Math.max(...Object.values(item));
  // Get the key or keys with the highest value
  const keys = Object.keys(item).filter((k) => item[k] === highest);

  // Return the key or keys with the highest value
  return keys.length === 1 ? keys[0] : keys.join(", ");
}

/**
 * Function to update the changesets and publish the data to MQTT
 *
 * @param client The MQTT client to publish the data to
 */
async function update(client: AsyncMqttClient | FakeClient) {
  logger.info("Performing update");
  // Check if the last update time is still today
  if (new Date(lastUpdateTime).getDate() !== new Date().getDate()) {
    logger.info("New day, resetting changesets");
    // Reset the mapCompleteChangesets array
    mapCompleteChangesets = [];
    // Reset the lastUpdateTime
    lastUpdateTime = new Date().setHours(0, 0, 0, 0);
  }

  // Get date in YYYY-MM-DD HH:MM:SS format, minus 10 minutes to account for delays, unless this means we go back to yesterday
  let date = new Date(lastUpdateTime - 1000 * 60 * 10).getTime();

  if (date < new Date().setHours(0, 0, 0, 0)) {
    date = new Date().setHours(0, 0, 0, 0);
  }

  const dateStr = new Date(date).toISOString().slice(0, 19).replace("T", " ");

  logger.info(`Getting changesets since ${dateStr}`);

  // Wrap the update in a try/catch block, so we can catch errors
  try {
    // Get the changesets from OSMCha
    const response = await fetch(
      `https://osmcha.org/api/v1/changesets/?date__gte=${encodeURIComponent(
        dateStr
      )}&editor=MapComplete`,
      {
        headers: {
          accept: "application/json",
          Authorization: process.env.OSMCHA_TOKEN,
        },
      }
    );

    // Parse the response
    const data: APIResponse = await response.json();

    logger.info(`Found ${data.features.length} new changesets`);

    // Loop through the changesets
    for (const changeset of data.features) {
      // Check if the changeset is already in the array
      if (mapCompleteChangesets.find((c) => c.id === changeset.id)) {
        // Skip this changeset
        continue;
      }

      // Add the changeset to the array
      mapCompleteChangesets.push(changeset);
    }

    // Sort the changesets by ID
    mapCompleteChangesets.sort((a, b) => a.id - b.id);

    // Determine all statistics

    // Total number of changesets
    const total = mapCompleteChangesets.length;

    // Unique users
    const userCount = new Set(
      mapCompleteChangesets.map((c) => c.properties.uid)
    ).size;

    // Users
    let users = mapCompleteChangesets.reduce((acc, cur) => {
      // If the user is not in the object, add it
      if (acc[cur.properties.user] === undefined) {
        acc[cur.properties.user] = 0;
      }
      // Increase the count for the user
      acc[cur.properties.user]++;
      return acc;
    }, {} as Record<string, number>);
    // Sort the users by the number of changesets
    users = Object.fromEntries(
      Object.entries(users).sort(([, a], [, b]) => b - a)
    );

    // Unique themes
    const themeCount = new Set(
      mapCompleteChangesets.map((c) => c.properties.metadata["theme"])
    ).size;

    // Themes
    let themes = mapCompleteChangesets.reduce((acc, cur) => {
      // Get the theme from the changeset
      const theme = cur.properties.metadata["theme"];
      // If the theme is not in the object, add it
      if (acc[theme] === undefined) {
        acc[theme] = 0;
      }
      // Increase the count for the theme
      acc[theme]++;
      return acc;
    }, {} as Record<string, number>);
    // Sort the themes by the number of changesets
    themes = Object.fromEntries(
      Object.entries(themes).sort(([, a], [, b]) => b - a)
    );

    // Make a list of colors for each changeset
    // const colorPromises = mapCompleteChangesets.map(async (c) => {
    //   // Get the color for the changeset0
    //   return getThemeColor(c);
    // });

    const colors: string[] = [];

    // Loop through the changesets
    for (const changeset of mapCompleteChangesets) {
      // Get the color for the changeset
      try {
        const color = await getThemeColor(changeset);
        // Add the color to the array
        colors.push(color);
      } catch (e) {
        logger.error(e);
        continue;
      }
    }

    // Wait for all colors to be fetched
    // const colors = await Promise.all(colorPromises);

    // Total number of answered questions of all changesets
    const questions = mapCompleteChangesets.reduce((acc, cur) => {
      // Check if the changeset has the answer metadata
      if (cur.properties.metadata["answer"] === undefined) {
        // Skip this changeset
        return acc;
      }
      // Get the number of answered questions from the changeset
      const changesetQuestions = parseInt(cur.properties.metadata["answer"]);
      // Add the number of answered questions to the total
      return acc + changesetQuestions;
    }, 0);

    // Total number of added images of all changesets
    const images = mapCompleteChangesets.reduce((acc, cur) => {
      // Check if the changeset has the image metadata
      if (cur.properties.metadata["add-image"] === undefined) {
        // Skip this changeset
        return acc;
      }
      // Get the number of added images from the changeset
      const changesetImages = parseInt(cur.properties.metadata["add-image"]);
      // Add the number of added images to the total
      return acc + changesetImages;
    }, 0);

    // Total number of added points of all changesets
    const points = mapCompleteChangesets.reduce((acc, cur) => {
      // Check if the changeset has the create metadata
      if (cur.properties.metadata["create"] === undefined) {
        // Skip this changeset
        return acc;
      }
      // Get the number of added points from the changeset
      const changesetPoints = parseInt(cur.properties.metadata["create"]);
      // Add the number of added points to the total
      return acc + changesetPoints;
    }, 0);

    let lastId: number | null;
    let lastUser: string | null;
    let lastTheme: string | null;
    let lastColor: string;
    let lastColorRgb: [number, number, number] | null;

    // Check if we actually have any changesets before we try to get the last changeset
    if (mapCompleteChangesets.length > 0) {
      // Get the last changeset
      const lastChangeset =
        mapCompleteChangesets[mapCompleteChangesets.length - 1];
      // Get the last changeset ID
      lastId = lastChangeset.id;
      // Get the last changeset user
      lastUser = lastChangeset.properties.user;
      // Get the last changeset theme
      lastTheme = lastChangeset.properties.metadata["theme"];
      // Get the last changeset color
      lastColor = colors[colors.length - 1];
      lastColorRgb = hexToRgb(lastColor);
    } else {
      // Set the last changeset ID to null
      lastId = null;
      // Set the last changeset user to null
      lastUser = null;
      // Set the last changeset theme to null
      lastTheme = null;
      // Set the last changeset color to null
      lastColor = null;
      lastColorRgb = null;
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
    };

    // Log the statistics
    logger.info(
      `Total changesets for today: ${statistics.changesets.total} by ${statistics.users.total} users, using ${statistics.themes.total} different themes`
    );
    logger.info(
      `Top 5 users: ${Object.entries(statistics.users.users)
        .slice(0, 5)
        .map(([user, count]) => `${user} (${count})`)
        .join(", ")}`
    );
    logger.info(
      `Top 5 themes: ${Object.entries(statistics.themes.themes)
        .slice(0, 5)
        .map(([theme, count]) => `${theme} (${count})`)
        .join(", ")}`
    );
    logger.info(
      `Total questions answered: ${statistics.questions}, total images added: ${statistics.images}, total points added: ${statistics.points}`
    );

    if (!dry_run) {
      // Publish the statistics to MQTT
      logger.info("Publishing statistics to MQTT");
      await client.publish(
        "mapcomplete/statistics",
        JSON.stringify(statistics),
        {
          retain: true,
        }
      );

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
            );
          }
          // Also publish the whole object
          await client.publish(
            `mapcomplete/statistics/${key}`,
            JSON.stringify(value),
            {
              retain: true,
            }
          );
        } else if (typeof value === "number") {
          await client.publish(
            `mapcomplete/statistics/${key}`,
            value.toString(),
            {
              retain: true,
            }
          );
        } else if (typeof value === "string") {
          await client.publish(`mapcomplete/statistics/${key}`, value, {
            retain: true,
          });
        } else {
          await client.publish(
            `mapcomplete/statistics/${key}`,
            JSON.stringify(value),
            {
              retain: true,
            }
          );
        }
      }
    } else {
      logger.info("Dry run, not publishing statistics to MQTT", statistics);
    }

    // Update the lastChangesetTime
    lastUpdateTime = new Date().getTime();
  } catch (error) {
    logger.error("Error while updating statistics", error);
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
      name: "MapComplete Changesets Today",
      unit_of_measurement: "changesets",
      state_topic: "mapcomplete/statistics/changesets/total",
      icon: "mdi:map-marker",
      unique_id: "mapcomplete_changesets_total",
      json_attributes_topic: "mapcomplete/statistics/changesets",
    },
    "homeassistant/sensor/mapcomplete/lastChangeset/config": {
      name: "MapComplete Last Changeset",
      state_topic: "mapcomplete/statistics/changesets/last",
      icon: "mdi:map-marker",
      unique_id: "mapcomplete_changesets_last",
      enabled_by_default: false,
    },
    "homeassistant/sensor/mapcomplete/lastChangesetColor/config": {
      name: "MapComplete Last Changeset Color",
      state_topic: "mapcomplete/statistics",
      icon: "mdi:palette",
      unique_id: "mapcomplete_changesets_last_color",
      enabled_by_default: false,
      value_template: "{{ value_json.changesets.lastColor }}",
    },
    "homeassistant/sensor/mapcomplete/lastChangesetColorRgb/config": {
      name: "MapComplete Last Changeset Color RGB",
      state_topic: "mapcomplete/statistics",
      icon: "mdi:palette",
      unique_id: "mapcomplete_changesets_last_color_rgb",
      enabled_by_default: false,
      value_template: "{{ value_json.changesets.lastColorRgb }}",
    },
    "homeassistant/sensor/mapcomplete/totalUsers/config": {
      name: "MapComplete Users Today",
      unit_of_measurement: "users",
      state_topic: "mapcomplete/statistics/users/total",
      icon: "mdi:account",
      unique_id: "mapcomplete_users_total",
      json_attributes_topic: "mapcomplete/statistics/users/users",
    },
    "homeassistant/sensor/mapcomplete/lastUser/config": {
      name: "MapComplete Last User",
      state_topic: "mapcomplete/statistics",
      icon: "mdi:account",
      unique_id: "mapcomplete_users_last",
      value_template: "{{ value_json.users.last }}",
    },
    "homeassistant/sensor/mapcomplete/topUser/config": {
      name: "MapComplete Top User(s)",
      state_topic: "mapcomplete/statistics",
      icon: "mdi:account",
      unique_id: "mapcomplete_users_top",
      value_template: "{{ value_json.users.top }}",
    },
    "homeassistant/sensor/mapcomplete/totalThemes/config": {
      name: "MapComplete Themes Used Today",
      unit_of_measurement: "themes",
      state_topic: "mapcomplete/statistics/themes/total",
      icon: "mdi:palette",
      unique_id: "mapcomplete_themes_total",
      json_attributes_topic: "mapcomplete/statistics/themes/themes",
    },
    "homeassistant/sensor/mapcomplete/lastTheme/config": {
      name: "MapComplete Last Theme",
      state_topic: "mapcomplete/statistics",
      icon: "mdi:palette",
      unique_id: "mapcomplete_themes_last",
      value_template: "{{ value_json.themes.last }}",
    },
    "homeassistant/sensor/mapcomplete/topTheme/config": {
      name: "MapComplete Top Theme(s)",
      state_topic: "mapcomplete/statistics",
      icon: "mdi:palette",
      unique_id: "mapcomplete_themes_top",
      value_template: "{{ value_json.themes.top }}",
    },
    "homeassistant/sensor/mapcomplete/totalQuestions/config": {
      name: "MapComplete Questions Answered Today",
      unit_of_measurement: "questions",
      state_topic: "mapcomplete/statistics/questions",
      icon: "mdi:comment-question",
      unique_id: "mapcomplete_questions_total",
    },
    "homeassistant/sensor/mapcomplete/totalImages/config": {
      name: "MapComplete Images Added Today",
      unit_of_measurement: "images",
      state_topic: "mapcomplete/statistics/images",
      icon: "mdi:image",
      unique_id: "mapcomplete_images_total",
    },
    "homeassistant/sensor/mapcomplete/totalPoints/config": {
      name: "MapComplete Points Added Today",
      unit_of_measurement: "points",
      state_topic: "mapcomplete/statistics/points",
      icon: "mdi:map-marker",
      unique_id: "mapcomplete_points_total",
    },
  };

  // Publish the configuration for each sensor
  logger.info("Publishing sensor configuration to MQTT");
  for (const [topic, payload] of Object.entries(sensors)) {
    if (!dry_run) {
      await client.publish(topic, JSON.stringify(payload), {
        retain: true,
      });
    } else {
      logger.info(
        "Dry run, not publishing sensor configuration to MQTT",
        topic,
        payload
      );
    }
  }
}

async function getThemeColor(changeset: Changeset): Promise<string> {
  const theme = changeset.properties.metadata["theme"];
  const host = changeset.properties.metadata["host"];

  // First check if we already have a color for this theme
  if (themeColors[theme]) {
    // We already have a color for this theme, return it
    return themeColors[theme];
  } else {
    // We'll need to download the theme file, find the image and extract the color
    let url;
    let baseUrl;

    if (
      host.startsWith("https://mapcomplete.osm.be/") ||
      host.startsWith("https://mapcomplete.org/")
    ) {
      baseUrl =
        "https://raw.githubusercontent.com/pietervdvn/MapComplete/master";
      url = `${baseUrl}/assets/themes/${theme}/${theme}.json`;
    } else if (host.startsWith("https://pietervdvn.github.io/mc/")) {
      // We'll need to parse the branch from the url
      // Example: https://pietervdvn.github.io/mc/feature/maplibre/index.html
      // Result: feature/maplibre

      const parts = host.split("/").slice(4, -1);
      const branch = parts.join("/");

      baseUrl = `https://raw.githubusercontent.com/pietervdvn/MapComplete/${branch}`;
      url = `${baseUrl}/assets/themes/${theme}/${theme}.json`;
    } else {
      // Return a default color
      logger.info(
        `No theme color found for ${theme} on ${host}, returning default`
      );
      return themeColors["default"];
    }

    // Override the url if the theme is a full url
    if (theme.startsWith("https://")) {
      // Unofficial theme, we'll need to download it from the url
      url = theme;
    }

    // logger.info(`Downloading theme file from ${url}`);
    const themeFile = await fetch(url);
    const themeJson: Theme = await themeFile.json();

    // Find the image
    let image = themeJson.icon;
    // If the image URL is relative, prepend the host from the url
    if (image.startsWith(".")) {
      image = `${baseUrl}/${image.slice(2)}`;
    }

    logger.info(`Downloading theme image for ${theme} from ${image}`);

    try {
      // Download the image
      const imageFile = await fetch(image);
      // Convert the image to an array buffer
      const imageArrayBuffer = await imageFile.arrayBuffer();
      // Convert array buffer to a buffer
      const imageBuffer = Buffer.from(imageArrayBuffer);

      const dominantColor = await getAverageColor(imageBuffer);

      // Convert the color to a hex string
      let color = dominantColor.hex;

      // If it is dark, use the default color
      if (dominantColor.isDark) {
        color = themeColors["default"];
      }

      // Save the color for future use
      themeColors[theme] = color;

      return color;
    } catch (e) {
      logger.error(
        `Failed to get color for ${theme} from ${image}, using default`,
        e
      );
      return themeColors["default"];
    }
  }
}

main();
