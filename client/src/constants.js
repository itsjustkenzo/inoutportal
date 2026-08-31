/**
 * Rules the forms enforce before the API does. Keep in step with
 * `server/src/models/User.js`, which is what actually enforces them — this
 * copy exists so the user sees the error before a round trip, not instead of it.
 */
export const MIN_PASSWORD_LENGTH = 6;

export const PASSWORD_RULE = `Password must be at least ${MIN_PASSWORD_LENGTH} characters`;
