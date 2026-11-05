// Reuse the genuine Auth/HTTP fixture with registered52 in a separate owned
// database/process. Every registered51 compatibility case still runs through
// quote-amendment-auth.test.mjs. No login limit or source guard is reset.
await import('./quote-amendment-auth.test.mjs?profile=cancellation52');
