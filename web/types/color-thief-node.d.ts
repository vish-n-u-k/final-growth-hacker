declare module 'color-thief-node' {
  export function getColorFromURL(url: string): Promise<[number, number, number]>
  export function getPaletteFromURL(url: string, colorCount?: number): Promise<[number, number, number][]>
}
