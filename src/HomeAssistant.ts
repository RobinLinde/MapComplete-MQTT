import { AsyncMqttClient } from "async-mqtt"
import FakeClient from "./FakeClient"
import { ExtendedTheme } from "./@types/MapComplete"
import { Logger } from "winston"
import { version } from "./Globals"
import { Changeset } from "./@types/OSMCha"
import { ThemeStatistics } from "./MapComplete"
import { Helpers } from "./Helpers"

/**
 * Various function required for the Home Assistant integration, mostly related to auto-discovery over MQTT.
 */

export class HomeAssistant {
  client: AsyncMqttClient | FakeClient
  logger: Logger
  helpers = new Helpers()

  constructor(client: AsyncMqttClient | FakeClient, logger: Logger) {
    this.client = client
    this.logger = logger
  }

  /**
   * Device configuration for the main MapComplete MQTT device
   */
  private readonly device = {
    name: "MapComplete",
    sw_version: version,
    model: "MapComplete Statistics",
    identifiers: ["mapcomplete"],
    manufacturer: "MapComplete MQTT",
  }

  /**
   * Function that publishes sensors for the total statistics
   *
   * For the theme-specific sensors, @see publishThemeSensorConfig
   *
   * @param client MQTT client or FakeClient
   */
  /**
   * Function to publish the configuration for the regular sensors
   *
   * For the theme-individual sensors, @see publishThemeConfig
   *
   * @param client MQTT client
   */
  public async publishSensorConfig(): Promise<void> {
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
        device: this.device,
      },
      "homeassistant/sensor/mapcomplete/lastChangeset/config": {
        name: "Last Changeset",
        state_topic: "mapcomplete/statistics/changesets/last",
        icon: "mdi:map-marker",
        unique_id: "mapcomplete_changesets_last",
        enabled_by_default: false,
        device: this.device,
      },
      "homeassistant/sensor/mapcomplete/lastChangesetColor/config": {
        name: "Last Changeset Color",
        state_topic: "mapcomplete/statistics",
        icon: "mdi:palette",
        unique_id: "mapcomplete_changesets_last_color",
        enabled_by_default: false,
        value_template: "{{ value_json.changesets.lastColor }}",
        device: this.device,
      },
      "homeassistant/sensor/mapcomplete/lastChangesetColorRgb/config": {
        name: "Last Changeset Color RGB",
        state_topic: "mapcomplete/statistics",
        icon: "mdi:palette",
        unique_id: "mapcomplete_changesets_last_color_rgb",
        enabled_by_default: false,
        value_template: "{{ value_json.changesets.lastColorRgb }}",
        device: this.device,
      },
      "homeassistant/sensor/mapcomplete/totalUsers/config": {
        name: "Users Today",
        unit_of_measurement: "users",
        state_topic: "mapcomplete/statistics/users/total",
        icon: "mdi:account",
        unique_id: "mapcomplete_users_total",
        json_attributes_topic: "mapcomplete/statistics/users/users",
        device: this.device,
      },
      "homeassistant/sensor/mapcomplete/lastUser/config": {
        name: "Last User",
        state_topic: "mapcomplete/statistics",
        icon: "mdi:account",
        unique_id: "mapcomplete_users_last",
        value_template: "{{ value_json.users.last }}",
        device: this.device,
      },
      "homeassistant/sensor/mapcomplete/topUser/config": {
        name: "Top User(s)",
        state_topic: "mapcomplete/statistics",
        icon: "mdi:account",
        unique_id: "mapcomplete_users_top",
        value_template: "{{ value_json.users.top }}",
        device: this.device,
      },
      "homeassistant/sensor/mapcomplete/totalThemes/config": {
        name: "Themes Used Today",
        unit_of_measurement: "themes",
        state_topic: "mapcomplete/statistics/themes/total",
        icon: "mdi:palette",
        unique_id: "mapcomplete_themes_total",
        json_attributes_topic: "mapcomplete/statistics/themes/themes",
        device: this.device,
      },
      "homeassistant/sensor/mapcomplete/lastTheme/config": {
        name: "Last Theme",
        state_topic: "mapcomplete/statistics",
        icon: "mdi:palette",
        unique_id: "mapcomplete_themes_last",
        value_template: "{{ value_json.themes.last }}",
        device: this.device,
      },
      "homeassistant/sensor/mapcomplete/topTheme/config": {
        name: "Top Theme(s)",
        state_topic: "mapcomplete/statistics",
        icon: "mdi:palette",
        unique_id: "mapcomplete_themes_top",
        value_template: "{{ value_json.themes.top }}",
        device: this.device,
      },
      "homeassistant/sensor/mapcomplete/totalQuestions/config": {
        name: "Questions Answered Today",
        unit_of_measurement: "questions",
        state_topic: "mapcomplete/statistics/questions",
        icon: "mdi:comment-question",
        unique_id: "mapcomplete_questions_total",
        device: this.device,
      },
      "homeassistant/sensor/mapcomplete/totalImages/config": {
        name: "Images Added Today",
        unit_of_measurement: "images",
        state_topic: "mapcomplete/statistics/images",
        icon: "mdi:image",
        unique_id: "mapcomplete_images_total",
        device: this.device,
      },
      "homeassistant/sensor/mapcomplete/totalPoints/config": {
        name: "Points Added Today",
        unit_of_measurement: "points",
        state_topic: "mapcomplete/statistics/points",
        icon: "mdi:map-marker",
        unique_id: "mapcomplete_points_total",
        device: this.device,
      },
    }

    // Publish the configuration for each sensor
    this.logger.info("Publishing sensor configuration to MQTT")
    for (const [topic, payload] of Object.entries(sensors)) {
      await this.client.publish(topic, JSON.stringify(payload), {
        retain: true,
      })
    }
  }

  /**
   * Function that publishes sensors for all not yet published themes.
   *
   * For the generic, total sensors, @see publishSensorConfig
   */
  public async publishThemeSensorConfig(themes: ExtendedTheme[]): Promise<void> {
    // Loop through the themes
    for (const theme of themes) {
      // Check if we have already published the theme
      if (!theme.published) {
        this.logger.info(`Publishing sensor configuration for ${theme.title}`)

        // Replace slashes in the theme ID with underscores
        const themeId = this.helpers.cleanThemeName(theme.id)

        // Create a Theme device
        const device = {
          name: theme.title,
          sw_version: version,
          model: "MapComplete Statistics",
          identifiers: [`mapcomplete_theme_${themeId}`],
          manufacturer: "MapComplete MQTT",
        }

        const sensors = {
          "homeassistant/sensor/mapcomplete/theme_[THEME_ID]_changesets/config": {
            name: "Changesets Today",
            state_topic: `mapcomplete/statistics/theme/${themeId}/changesets/total`,
            entity_picture: theme.icon,
            icon: "mdi:map-marker",
            unit_of_measurement: "changesets",
            unique_id: `mapcomplete_theme_${themeId}_changesets`,
            device,
          },
          "homeassistant/image/mapcomplete/theme_[THEME_ID]_icon/config": {
            name: "Icon",
            url_topic: `mapcomplete/statistics/theme/${themeId}/icon`,
            entity_picture: theme.icon,
            unique_id: `mapcomplete_theme_${themeId}_icon`,
            device,
          },
          "homeassistant/sensor/mapcomplete/theme_[THEME_ID]_users/config": {
            name: "Users Today",
            state_topic: `mapcomplete/statistics/theme/${themeId}/users/total`,
            icon: "mdi:account",
            unit_of_measurement: "users",
            unique_id: `mapcomplete_theme_${themeId}_users`,
            device,
          },
          "homeassistant/sensor/mapcomplete/theme_[THEME_ID]_last_user/config": {
            name: "Last User",
            state_topic: `mapcomplete/statistics/theme/${themeId}`,
            icon: "mdi:account",
            unique_id: `mapcomplete_theme_${themeId}_last_user`,
            value_template: "{{ value_json.users.last }}",
            device,
          },
          "homeassistant/sensor/mapcomplete/theme_[THEME_ID]_top_user/config": {
            name: "Top User(s)",
            state_topic: `mapcomplete/statistics/theme/${themeId}`,
            icon: "mdi:account",
            unique_id: `mapcomplete_theme_${themeId}_top_user`,
            value_template: "{{ value_json.users.top }}",
            device,
          },
          "homeassistant/sensor/mapcomplete/theme_[THEME_ID]_questions/config": {
            name: "Questions Answered",
            state_topic: `mapcomplete/statistics/theme/${themeId}/questions`,
            icon: "mdi:comment-question",
            unique_id: `mapcomplete_theme_${themeId}_questions`,
            device,
          },
          "homeassistant/sensor/mapcomplete/theme_[THEME_ID]_images/config": {
            name: "Images Added",
            state_topic: `mapcomplete/statistics/theme/${themeId}/images`,
            icon: "mdi:image",
            unique_id: `mapcomplete_theme_${themeId}_images`,
            device,
          },
          "homeassistant/sensor/mapcomplete/theme_[THEME_ID]_points/config": {
            name: "Points Added",
            state_topic: `mapcomplete/statistics/theme/${themeId}/points`,
            icon: "mdi:map-marker",
            unique_id: `mapcomplete_theme_${themeId}_points`,
            device,
          },
        }

        // Publish the sensor configuration
        for (const [topic, payload] of Object.entries(sensors)) {
          await this.client.publish(topic.replace("[THEME_ID]", themeId), JSON.stringify(payload), {
            retain: true,
          })
        }
        // Mark the theme as published
        theme.published = true
      }
    }
  }

  public async cleanUpSensors(
    themes: ExtendedTheme[],
    mapCompleteChangesets: Changeset[]
  ): Promise<void> {
    // Look for themes that exist only in the mapCompleteThemes array, but not in the mapCompleteChangesets array
    const themesInChangesets = mapCompleteChangesets.map(
      (changeset) => changeset.properties.metadata["theme"]
    )
    const themesToRemove = themes.filter((theme) => !themesInChangesets.includes(theme.id))

    // Loop through the themes to remove, with remove being the sending of an empty statistics object
    for (const theme of themesToRemove) {
      // Create an empty statistics object
      const statistics: ThemeStatistics = {
        changesets: {
          last: null,
          total: 0,
          lastUrl: null,
        },
        users: {
          last: null,
          total: 0,
          top: null,
          users: {},
        },
        questions: 0,
        images: 0,
        points: 0,
      }

      // Clean the theme name
      const themeId = this.helpers.cleanThemeName(theme.id)

      // Publish the statistics
      await this.client.publish(
        `mapcomplete/statistics/theme/${themeId}`,
        JSON.stringify(statistics),
        {
          retain: true,
        }
      )

      // Also send the empty statistics to their own topics
      for (const [topic, payload] of Object.entries(statistics)) {
        await this.client.publish(
          `mapcomplete/statistics/theme/${themeId}/${topic}`,
          JSON.stringify(payload),
          {
            retain: true,
          }
        )
        // Also go one level deeper, if the payload is an object
        if (typeof payload === "object") {
          for (const [subTopic, subPayload] of Object.entries(payload)) {
            await this.client.publish(
              `mapcomplete/statistics/theme/${themeId}/${topic}/${subTopic}`,
              JSON.stringify(subPayload),
              {
                retain: true,
              }
            )
          }
        }
      }
    }
  }
}
