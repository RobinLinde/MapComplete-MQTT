# MapComplete-MQTT

MapComplete-MQTT is a serrvice publishing statistics about [OpenStreetMap](https://www.openstreetmap.org) changesets made with [MapComplete](https://github.com/pietervdvn/MapComplete) to an MQTT broker.

## Running the service

For running the service, there needs to be an MQTT broker running and some environment variables set.

Below is a summary of the environment variables:

| Variable          | Description                                               | Default     |
| ----------------- | --------------------------------------------------------- | ----------- |
| `MQTT_HOST`       | The host of the MQTT broker                               | `localhost` |
| `MQTT_PORT`       | The port of the MQTT broker                               | `1883`      |
| `MQTT_USERNAME`   | The username for the MQTT broker                          | empty       |
| `MQTT_PASSWORD`   | The password for the MQTT broker                          | empty       |
| `OSMCHA_TOKEN`    | The token for OSMCha (required)                           | empty       |
| `DRY_RUN`         | If set to `True`, no data is published to the MQTT broker | `False`     |
| `UPDATE_INTERVAL` | The interval in seconds between updates                   | `300`       |

These can be set in an `.env` file (see `.env.example`) or by setting the environment variables yourself.
The necessary OSMCha token can be obtained by logging in to [OSMCha](https://osmcha.org) and copying the token from the Account Settings page.

Then the application can be either run directly with node or with Docker.

### Running with node

To run the application with node, run `npm install` and `npm start`.

### Running with Docker

To run the application with Docker, either build it locally using `docker build -t mapcomplete-mqtt .` or pull it from Docker Hub using `docker pull ghcr.io/RobinLinde/mapcomplete-mqtt`.

Then run the container either by passing the environment variables directly or by using an `.env` file (see `.env.example`) using `docker run --name mapcomplete-mqtt --env-file .env mapcomplete-mqtt` or `docker run --name mapcomplete-mqtt -e MQTT_HOST=localhost -e MQTT_USERNAME=user -e MQTT_PASSWORD=pass -e OSMCHA_TOKEN=token mapcomplete-mqtt`.

## Using the data

Data is published to the topic `mapcomplete/statistics` on the MQTT broker, with the payload being a JSON object as shown below.

Most items are also available on their own topic, e.g. `mapcomplete/statistics/changesets/total` or `mapcomplete/statistics/users/top`.

Apart from this, some data is also published as a Home Assistant sensors, contained by a Home Assistant device (see [list](#home-assistant-sensors) below). There are also devices and sensors for each theme, but these are not individually listed.

### Home Assistant sensors

| Sensor ID                           | Description                                                            |
| ----------------------------------- | ---------------------------------------------------------------------- |
| `mapcomplete_changesets_total`      | The total number of changesets                                         |
| `mapcomplete_changesets_last`       | The ID of the last changeset (disabled by default)                     |
| `mapcomplete_changesets_last_color` | The color of the last changeset, as a hex string (disabled by default) |
| `mapcomplete_changesets_last_rgb`   | The color of the last changeset, as an RGB array (disabled by default) |
| `mapcomplete_users_total`           | The total number of users                                              |
| `mapcomplete_users_last`            | The username of the last user                                          |
| `mapcomplete_users_top`             | The username of the top user                                           |
| `mapcomplete_themes_total`          | The total number of themes                                             |
| `mapcomplete_themes_last`           | The name of the last theme                                             |
| `mapcomplete_themes_top`            | The names of the top themes                                            |
| `mapcomplete_questions_total`       | The total number of questions answered                                 |
| `mapcomplete_images_total`          | The total number of images uploaded                                    |
| `mapcomplete_points_total`          | The total number of points added                                       |

### Example data

```json
{
  "changesets": {
    "total": 3,
    "last": 1234,
    "lastUrl": "https://www.osm.org/changeset/1234",
    "lastColor": "#fffe73",
    "lastColorRgb": [255, 254, 115],
    "colors": ["#70c549", "#e2783d", "#fffe73"],
    "colorsStr": "#70c549,#e2783d,#fffe73",
    "colorsRgb": [
      [112, 197, 73],
      [226, 120, 61],
      [255, 254, 115]
    ],
    "colorsRgbStr": "112,197,73,226,120,61,255,254,115",
    "changesets": [
      {
        "id": 1231,
        "user": "user1",
        "theme": "etymology",
        "color": "#70c549",
        "colorRgb": [112, 197, 73],

        "url": "https://www.osm.org/changeset/1232"
      },
      {
        "id": 1233,
        "user": "user2",
        "color": "#e2783d",
        "colorRgb": [226, 120, 61],
        "theme": "cyclofix",
        "url": "https://www.osm.org/changeset/1233"
      },
      {
        "id": 1234,
        "user": "user2",
        "color": "#fffe73",
        "colorRgb": [255, 254, 115],
        "theme": "advertising",
        "url": "https://www.osm.org/changeset/1234"
      }
    ]
  },
  "users": {
    "total": 3,
    "last": "user2",
    "top": "user2",
    "users": {
      "user1": 1,
      "user2": 2
    }
  },
  "themes": {
    "total": 3,
    "top": "etymology, cyclofix, advertising",
    "last": "advertising",
    "themes": {
      "etymology": 1,
      "cyclofix": 1,
      "advertising": 1
    }
  },
  "questions": 10,
  "images": 2,
  "points": 3
}
```
