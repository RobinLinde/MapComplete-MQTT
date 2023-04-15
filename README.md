# MapComplete-MQTT

MapComplete-MQTT is a serrvice publishing statistics about [OpenStreetMap](https://www.openstreetmap.org) changesets made with [MapComplete](https://github.com/pietervdvn/MapComplete) to an MQTT broker.

## Data example

```json
{
  "changesets": {
    "total": 3,
    "colors": ["#70c549", "#e2783d", "#fffe73"],
    "colorsStr": "#70c549,#e2783d,#fffe73",
    "colorsRgb": [
      [112, 197, 73],
      [226, 120, 61],
      [255, 254, 115]
    ],
    "colorsRgbStr": "112,197,73,226,120,61,255,254,115"
  },
  "users": {
    "total": 3,
    "top": "user2",
    "users": {
      "user1": 1,
      "user2": 2
    }
  },
  "themes": {
    "total": 3,
    "top": "etymology, cyclofix, advertising",
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

## Running the service

You can run the service by creating an `.env` file (see `.env.example`) or by setting the environment variables yourself.

To get a token for OSMCha, you need to log in to [OSMCha](https://osmcha.org) and copy the token from the Account Settings page.

Then run `npm install` and `npm start`.

Data is published to the topic `mapcomplete/statistics` on the MQTT broker.
