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

// Lookup table
const themeColors = {
  default: "#70c549",
  personal: "#37d649",
  cyclofix: "#e2783d",
  advertising: "#fffe73",
  aed: "#008855",
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

  console.log(`Found ${data.features.length} changesets`);

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
  const themes = mapCompleteChangesets.reduce((acc, cur) => {
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

  const statistics = {
    changesets: {
      total,
      colors,
    },
    users: {
      total: userCount,
      users,
    },
    themes: {
      total: themeCount,
      themes,
    },
  };

  // Log the statistics
  console.log(
    `Total changesets for today: ${statistics.changesets.total} by ${statistics.users.total} users, using ${statistics.themes.total} different themes`
  );

  // Publish the statistics to MQTT
  await client.publish("mapcomplete/statistics", JSON.stringify(statistics), {
    retain: true,
  });

  // Update the lastChangesetTime
  lastUpdateTime = new Date().getTime();
}

main();
