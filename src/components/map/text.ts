/** Rough width of a label at a given font size, for pill sizing. */
export function estimateTextWidth(text: string, fontSize: number): number {
  return text.length * fontSize * 0.58 + 4;
}
