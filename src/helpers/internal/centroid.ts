export interface Point {
  readonly x: number
  readonly y: number
}

/**
 * Compute the centroid of a CDP quad.
 *
 * A quad is a flat array of 8 numbers: [x1, y1, x2, y2, x3, y3, x4, y4].
 * The centroid is the average of the four corner points.
 */
export const centroid = (quad: ReadonlyArray<number>): Point => {
  if (quad.length < 8) {
    return { x: 0, y: 0 }
  }
  const x = (quad[0]! + quad[2]! + quad[4]! + quad[6]!) / 4
  const y = (quad[1]! + quad[3]! + quad[5]! + quad[7]!) / 4
  return { x, y }
}
