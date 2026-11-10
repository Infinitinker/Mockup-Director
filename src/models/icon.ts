/**
 * The frame of the models' gallery icons: line art on a 64 × 64 grid, stroked in the current color
 * with round caps and joins.
 */

/** Wrap icon paths in the common SVG frame; the stroke is 2.75 wide unless another width is given. */
export function icon(body: string, strokeWidth = 2.75): string {
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" ' +
    `stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round">` +
    body +
    '</svg>'
  );
}
