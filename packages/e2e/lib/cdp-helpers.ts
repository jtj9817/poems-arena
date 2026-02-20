import type { Page, CDPSession } from '@playwright/test';

/**
 * Creates a Chrome DevTools Protocol session from a Playwright page.
 */
export async function createCDPSession(page: Page): Promise<CDPSession> {
  return page.context().newCDPSession(page);
}

/**
 * Queries all elements matching a CSS selector via CDP Runtime.evaluate.
 * Returns an array of outer HTML strings.
 */
export async function querySelectorAllViaDOM(
  session: CDPSession,
  selector: string,
): Promise<string[]> {
  const result = await session.send('Runtime.evaluate', {
    expression: `
      Array.from(document.querySelectorAll(${JSON.stringify(selector)}))
        .map(el => el.outerHTML)
    `,
    returnByValue: true,
  });

  return (result.result.value as string[]) ?? [];
}

/**
 * Returns the outer HTML of the first element matching the selector, or null.
 */
export async function getOuterHTMLViaDOM(
  session: CDPSession,
  selector: string,
): Promise<string | null> {
  const result = await session.send('Runtime.evaluate', {
    expression: `
      (() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        return el ? el.outerHTML : null;
      })()
    `,
    returnByValue: true,
  });

  return (result.result.value as string | null) ?? null;
}
