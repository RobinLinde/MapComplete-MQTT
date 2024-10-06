/**
 * Class containing helper functions
 */
export class Helpers {
  /**
   * Function to convert a hex color code to an RGB color code
   *
   * @param hex Hex color code
   * @returns RGB color code
   */
  public hexToRgb(hex: string): [number, number, number] {
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
  public findTop(item: Record<string, number>): string {
    // Get the highest value
    const highest = Math.max(...Object.values(item))
    // Get the key or keys with the highest value
    const keys = Object.keys(item).filter((k) => item[k] === highest)

    // Return the key or keys with the highest value
    return keys.length === 1 ? keys[0] : keys.join(", ")
  }

  /**
   * Function to clean a theme name, currently just replaces slashes with underscores
   *
   * @param name Name to clean
   * @returns Cleaned name
   */
  public cleanThemeName(name: string): string {
    // Replace slashes with underscores
    return name.replace("/", "_")
  }
}
