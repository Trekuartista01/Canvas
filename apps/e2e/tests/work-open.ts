import { test as base } from "@playwright/test";

/**
 * For specs about what's inside a task panel's Work section (subtasks, files,
 * generation…), not about the panel's layout. The section starts closed, so
 * this opens it whenever a panel appears. task-panel.spec.ts covers the default.
 */
export const test = base.extend({
  context: async ({ context }, use) => {
    await context.addInitScript(() => {
      const open = () => {
        document
          .querySelectorAll<HTMLButtonElement>(
            '[data-testid="detail-group-Work"][aria-expanded="false"]',
          )
          .forEach((button) => button.click());
      };
      new MutationObserver(open).observe(document, { childList: true, subtree: true });
    });
    await use(context);
  },
});
