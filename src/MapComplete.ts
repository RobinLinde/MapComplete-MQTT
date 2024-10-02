import { Logger } from "winston"
import { Changeset } from "./@types/OSMCha"
import { ExtendedTheme, Theme } from "./@types/MapComplete"
import { getAverageColor } from "fast-average-color-node"
import { Helpers } from "./Helpers"

/**
 * Interface for the statistics object we create
 */
export interface Statistics {
  /**
   * Details about the changesets
   */
  changesets: {
    /**
     * Total number of changesets today
     */
    total: number

    /**
     * Numeric ID of the last changeset
     */
    last: number

    /**
     * URL of the last changeset
     */
    lastUrl: string

    /**
     * Color of the last changeset, as a hex string
     */
    lastColor: string
    lastColorRgb: [number, number, number]
    colors: string[]
    colorsStr: string
    colorsRgb: [number, number, number][]
    colorsRgbStr: string
    changesets: {
      id: number
      user: string
      theme: string
      color: string
      colorRgb: [number, number, number]
      url: string
    }[]
  }
  users: {
    total: number
    top: string
    last: string
    users: Record<string, number>
  }
  themes: {
    total: number
    top: string
    last: string
    themes: Record<string, number>
  }
  questions: number
  images: number
  points: number
}

/**
 * Class for interacting/analyzing with MapComplete Themes
 */
export class MapComplete {
  mapCompleteThemes: ExtendedTheme[]
  logger: Logger
  helpers = new Helpers()

  constructor(mapCompleteThemes: ExtendedTheme[], logger: Logger) {
    this.mapCompleteThemes = mapCompleteThemes
    this.logger = logger
  }

  // Lookup table
  private readonly themeColors = {
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

  /**
   * This function gets the theme color and some other information from the theme used in a changeset
   *
   * @param changeset Changeset to get information from
   * @returns Object containing the color, icon and name of the theme
   */
  private async getThemeDetails(changeset: Changeset): Promise<{
    color: string
    icon: string
    name: string
  }> {
    const theme = changeset.properties.metadata["theme"]
    const host = changeset.properties.metadata["host"]

    this.logger.debug(`Getting theme details for ${theme} on ${host}`)

    // First check if we already have details for this theme
    if (this.mapCompleteThemes.find((t) => t.id === theme)) {
      // We already have all details for this theme, return it
      const themeDetails = this.mapCompleteThemes.find((t) => t.id === theme)
      return {
        color: themeDetails.color,
        icon: themeDetails.icon,
        name: themeDetails.title,
      }
    } else {
      // We'll need to download the theme file, find the image and extract the color
      const themeDetails = await this.getThemeFile(theme, host)

      let color: string

      // Determine image URL
      let image = themeDetails.theme.icon

      // If the image URL is relative, prepend the host from the url
      if (image.startsWith(".")) {
        image = `${themeDetails.baseUrl}/${image.slice(2)}`
      }

      // Check if we already have a predefined color for this theme
      if (this.themeColors[theme]) {
        color = this.themeColors[theme]
      } else {
        // We need to analyze the image to get the color

        this.logger.info(`Downloading theme image for ${theme} from ${image}`)
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
            color = this.themeColors["default"]
          }
        } catch (e) {
          this.logger.error(`Failed to get color for ${theme} from ${image}, using default`, e)
          color = this.themeColors["default"]
        }

        this.logger.debug(
          "Theme details",
          theme,
          color,
          image,
          this.determineTitle(themeDetails.theme.title)
        )
      }

      // Return the details
      return {
        color,
        icon: image,
        name: this.determineTitle(themeDetails.theme.title),
      }
    }
  }

  /**
   * Function to get the statistics for a list of changesets
   *
   * @param changesets List of changesets to get statistics for
   * @returns Object containing the statistics
   */
  public async getStatistics(changesets: Changeset[]): Promise<Statistics> {
    // Determine all statistics

    // Total number of changesets
    const total = changesets.length

    // Unique users
    const userCount = new Set(changesets.map((c) => c.properties.uid)).size

    // Users
    let users = changesets.reduce((acc, cur) => {
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
    const themeCount = new Set(changesets.map((c) => c.properties.metadata["theme"])).size

    // Themes
    let themes = changesets.reduce((acc, cur) => {
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
    for (const changeset of changesets) {
      // Get the details for the changeset
      try {
        const themeDetails = await this.getThemeDetails(changeset)
        // Add the color to the array
        colors.push(themeDetails.color)
        // Add the theme to the list of themes, if it is not already there
        if (!this.mapCompleteThemes.find((t) => t.id === changeset.properties.metadata["theme"])) {
          this.mapCompleteThemes.push({
            id: changeset.properties.metadata["theme"],
            title: themeDetails.name,
            icon: themeDetails.icon,
            published: false,
            color: themeDetails.color,
          })
        }
      } catch (e) {
        this.logger.error("Error while getting theme details", e)
        continue
      }
    }

    // Total number of answered questions of all changesets
    const questions = changesets.reduce((acc, cur) => {
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
    const images = changesets.reduce((acc, cur) => {
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
    const points = changesets.reduce((acc, cur) => {
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
    if (changesets.length > 0) {
      // Get the last changeset
      const lastChangeset = changesets[changesets.length - 1]
      // Get the last changeset ID
      lastId = lastChangeset.id
      // Get the last changeset user
      lastUser = lastChangeset.properties.user
      // Get the last changeset theme
      lastTheme = lastChangeset.properties.metadata["theme"]
      // Get the last changeset color
      lastColor = colors[colors.length - 1]
      lastColorRgb = this.helpers.hexToRgb(lastColor)
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

    const statistics: Statistics = {
      changesets: {
        total,
        last: lastId,
        lastUrl: `https://osm.org/changeset/${lastId}`,
        lastColor,
        lastColorRgb,
        colors,
        colorsStr: colors.join(","),
        colorsRgb: colors.map((c) => this.helpers.hexToRgb(c)),
        colorsRgbStr: colors.map((c) => this.helpers.hexToRgb(c)).join(","),
        changesets: changesets.map((c) => ({
          id: c.id,
          user: c.properties.user,
          theme: c.properties.metadata["theme"],
          color: colors[changesets.indexOf(c)],
          colorRgb: this.helpers.hexToRgb(colors[changesets.indexOf(c)]),
          url: `https://osm.org/changeset/${c.id}`,
        })),
      },
      users: {
        total: userCount,
        top: this.helpers.findTop(users),
        last: lastUser,
        users,
      },
      themes: {
        total: themeCount,
        top: this.helpers.findTop(themes),
        last: lastTheme,
        themes,
      },
      questions,
      images,
      points,
    }

    return statistics
  }

  /**
   * Function that tries to get a theme file, based on the theme id and host
   *
   * @param theme Theme id
   * @param host Host of the changeset
   *
   * @returns Theme object, containing at least the id, icon and title, maybe the complete theme file
   */
  private async getThemeFile(
    theme: string,
    host: string
  ): Promise<{ theme: Theme; baseUrl: string }> {
    let url
    let baseUrl

    if (theme.startsWith("https://")) {
      // External themes, we can download them from the given URL, no need to parse the host
      baseUrl = theme // This is technically not correct, but it's the best we can do
      url = theme
    } else if (
      host.startsWith("https://mapcomplete.osm.be/") ||
      host.startsWith("https://mapcomplete.org/")
    ) {
      // Official themes, we can download them from the main repository
      baseUrl = "https://raw.githubusercontent.com/pietervdvn/MapComplete/master"
      url = `${baseUrl}/assets/themes/${theme}/${theme}.json`
    } else if (host.startsWith("https://pietervdvn.github.io/mc/")) {
      // Development branches, we'll need to parse the branch from the url
      // Example: https://pietervdvn.github.io/mc/feature/maplibre/index.html
      // Result: feature/maplibre
      const parts = host.split("/").slice(4, -1)
      const branch = parts.join("/")

      baseUrl = `https://raw.githubusercontent.com/pietervdvn/MapComplete/${branch}`
      url = `${baseUrl}/assets/themes/${theme}/${theme}.json`
    } else {
      // Return a default color and icon, as well as the theme id as name
      this.logger.info(`No theme file found for ${theme} on ${host}, returning default information`)
      return {
        theme: {
          id: theme,
          icon: "https://raw.githubusercontent.com/pietervdvn/MapComplete/refs/heads/develop/assets/svg/add.svg",
          title: theme,
        },
        baseUrl,
      }
    }

    // Download the theme file
    const themeFile = await fetch(url)
    const themeJson = await themeFile.json()

    // Return the theme object
    return {
      theme: themeJson,
      baseUrl,
    }
  }

  /**
   * Small helper function to determine the title of a theme
   *
   * @param title Title object or string
   * @returns String containing the title
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private determineTitle(title: any): string {
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
}
