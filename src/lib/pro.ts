/**
 * Who may use the Pro tab.
 *
 * Everything in Pro is free to every signed-in user today. "Pro" is a name
 * for where the heavier tools live, not a paid tier, and no payments or
 * subscriptions exist in this app.
 *
 * It is a function rather than an inline `true` so that adding billing later
 * is one change here instead of a hunt through the components.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- the parameter
// is the seam a real gate would read; silencing it beats inventing a check.
export function canUsePro(account: unknown): boolean {
  return true;
}
