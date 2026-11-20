// Warnings and errors that show up on the GitHub Actions run page (as yellow
// and red annotations) when running there, and as plain log lines elsewhere.

const IN_ACTIONS = process.env.GITHUB_ACTIONS === 'true';

// Workflow commands are one line; GitHub decodes these escapes.
const escape = (msg) => String(msg).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');

export function warning(msg) {
  console.warn(IN_ACTIONS ? `::warning title=Image backup::${escape(msg)}` : msg);
}

export function error(msg) {
  console.error(IN_ACTIONS ? `::error title=Image backup::${escape(msg)}` : msg);
}
