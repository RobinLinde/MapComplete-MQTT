import { AsyncMqttClient } from "async-mqtt"
import FakeClient from "./FakeClient"
import { ExtendedTheme } from "./@types/MapComplete"
import { Logger } from "winston"
import { version } from "./Globals"

/**
 * Various function required for the Home Assistant integration, mostly related to auto-discovery over MQTT.
 */

export class HomeAssistant {
  client: AsyncMqttClient | FakeClient
  logger: Logger

  constructor(client: AsyncMqttClient | FakeClient, logger: Logger) {
    this.client = client
    this.logger = logger
  }

  /**
   * Device configuration for the main MapComplete MQTT device
   */
  private readonly device = {
    name: "MapComplete",
    identifiers: ["mapcomplete"],
    sw_version: version,
    model: "MapComplete Statistics",
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
        // Publish the sensor configuration
        this.logger.info(`Publishing sensor configuration for ${theme.title}`)
        await this.client.publish(
          `homeassistant/sensor/mapcomplete/theme_${theme.id}_changesets/config`,
          JSON.stringify(changesetsSensor),
          {
            retain: true,
          }
        )

        await this.client.publish(
          `homeassistant/image/mapcomplete/theme_${theme.id}_icon/config`,
          JSON.stringify(iconImage),
          {
            retain: true,
          }
        )

        await this.client.publish(
          `homeassistant/sensor/mapcomplete/theme_${theme.id}_users/config`,
          JSON.stringify(usersSensor),
          {
            retain: true,
          }
        )

        await this.client.publish(
          `homeassistant/sensor/mapcomplete/theme_${theme.id}_top_user/config`,
          JSON.stringify(topUserSensor),
          {
            retain: true,
          }
        )

        // Mark the theme as published
        theme.published = true
      }
    }
  }
}
