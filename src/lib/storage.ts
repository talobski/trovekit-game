/** Browser preferences and room sessions, kept under the `trovekit:` namespace. */
export function readStored(suffix: string): string | null {
  return localStorage.getItem(`trovekit:${suffix}`)
}

export function writeStored(suffix: string, value: string) {
  localStorage.setItem(`trovekit:${suffix}`, value)
}

export function removeStored(suffix: string) {
  localStorage.removeItem(`trovekit:${suffix}`)
}
