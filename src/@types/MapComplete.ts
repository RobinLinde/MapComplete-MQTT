export interface Theme {
  id: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  title: string | any
  icon: string
}

export interface ExtendedTheme extends Theme {
  /**
   * Whether we've already published a sensor config for this theme
   */
  published: boolean
  /**
   * The determined color for this theme
   */
  color: string
}
