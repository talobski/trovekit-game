import { test as base } from "@playwright/test"
export { expect } from "@playwright/test"
export type { Browser, Locator, Page } from "@playwright/test"

/** Multiplayer tests create several independent browser profiles. Playwright's
 * page fixture only owns its own context; close the extra profiles after each
 * test so their sockets and polling do not accumulate across the worker.
 */
export const test = base.extend<{ cleanupContexts: void }>({
  cleanupContexts: [async ({ browser }, use) => {
    const previous = new Set(browser.contexts())
    try { await use() }
    finally { await Promise.all(browser.contexts().filter(context => !previous.has(context)).map(context => context.close())) }
  }, { auto: true }],
})
