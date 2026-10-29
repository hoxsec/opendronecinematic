/** Give input and rendering a turn between chunks, even when all tile data is cached. */
export function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
