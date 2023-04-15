import * as dotenv from "dotenv";
import { AsyncMqttClient, connect, connectAsync } from "async-mqtt";
import type { APIResponse, Changeset } from "./@types/osmcha";

// Standard variables
dotenv.config();
const mqtt_host = process.env.MQTT_HOST || "localhost";
const mqtt_port = process.env.MQTT_PORT
  ? parseInt(process.env.MQTT_PORT)
  : 1883;
const mqtt_username = process.env.MQTT_USERNAME || "";
const mqtt_password = process.env.MQTT_PASSWORD || "";
const dry_run = process.env.DRY_RUN === "True" || false;

// Lookup table
const themeColors = {
  default: "#70c549",
  personal: "#37d649",
  cyclofix: "#e2783d",
  advertising: "#fffe73",
  aed: "#008855",
  cycle_infra: "#f7d728",
  drinking_water: "#66bef3",
  maxspeed: "#e41408",
  onwheels: "#22ca60",
  postboxes: "#ff6242",
};

// Variables for storing the changesets
let lastUpdateTime = new Date().setHours(0, 0, 0, 0);
let mapCompleteChangesets: Changeset[] = [];

// Check if the OSMCha token is set
if (process.env.OSMCHA_TOKEN === undefined) {
  console.error("OSMCHA_TOKEN is not set");
  process.exit(1);
}

/**
 * Main loop connecting to MQTT and performing the update
 */
async function main() {
  const client = await connectAsync({
    host: mqtt_host,
    port: mqtt_port,
    username: mqtt_username,
    password: mqtt_password,
  });

  // Perform initial update
  update(client);

  // Create a loop to send a message every 5 minutes
  setInterval(async () => update(client), 1000 * 60 * 5);
}

/**
 * Function to convert a hex color code to an RGB color code
 *
 * @param hex Hex color code
 * @returns RGB color code
 */
function hexToRgb(hex: string): number[] {
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
async function update(client: AsyncMqttClient) {
  console.log("Performing update");
  // Check if the last update time is still today
  if (new Date(lastUpdateTime).getDate() !== new Date().getDate()) {
    console.log("New day, resetting changesets");
    // Reset the mapCompleteChangesets array
    mapCompleteChangesets = [];
    // Reset the lastUpdateTime
    lastUpdateTime = new Date().setHours(0, 0, 0, 0);
  }

  // Get date in YYYY-MM-DD HH:MM:SS format
  const date = new Date(lastUpdateTime - 1000 * 60 * 10)
    .toISOString()
    .slice(0, 19)
    .replace("T", " ");

  // Get the changesets from OSMCha
  const response = await fetch(
    `https://osmcha.org/api/v1/changesets/?date__gte=${encodeURIComponent(
      date
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

  console.log(`Found ${data.features.length} new changesets`);

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
  const userCount = new Set(mapCompleteChangesets.map((c) => c.properties.uid))
    .size;

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
  const colors = mapCompleteChangesets.map((c) => {
    // Get the theme from the changeset
    const theme = c.properties.metadata["theme"];
    // Check if the theme is in the lookup table
    if (themeColors[theme] !== undefined) {
      // Return the color from the lookup table
      return themeColors[theme];
    }
    // Return the default color
    return themeColors.default;
  });

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

  const statistics = {
    changesets: {
      total,
      colors,
      colorsStr: colors.join(","),
      colorsRgb: colors.map((c) => hexToRgb(c)),
      colorsRgbStr: colors.map((c) => hexToRgb(c)).join(","),
    },
    users: {
      total: userCount,
      top: findTop(users),
      users,
    },
    themes: {
      total: themeCount,
      top: findTop(themes),
      themes,
    },
    questions,
    images,
    points,
  };

  // Log the statistics
  console.log(
    `Total changesets for today: ${statistics.changesets.total} by ${statistics.users.total} users, using ${statistics.themes.total} different themes`
  );
  console.log(
    `Top 5 users: ${Object.entries(statistics.users.users)
      .slice(0, 5)
      .map(([user, count]) => `${user} (${count})`)
      .join(", ")}`
  );
  console.log(
    `Top 5 themes: ${Object.entries(statistics.themes.themes)
      .slice(0, 5)
      .map(([theme, count]) => `${theme} (${count})`)
      .join(", ")}`
  );
  console.log(
    `Total questions answered: ${statistics.questions}, total images added: ${statistics.images}, total points added: ${statistics.points}`
  );

  if (!dry_run) {
    // Publish the statistics to MQTT
    console.log("Publishing statistics to MQTT");
    await client.publish("mapcomplete/statistics", JSON.stringify(statistics), {
      retain: true,
    });

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
    console.log("Dry run, not publishing statistics to MQTT", statistics);
  }

  // Update the lastChangesetTime
  lastUpdateTime = new Date().getTime();
}

main();
