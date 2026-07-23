// Shared helper: finds the source URL of the last content image (the
// mcnImage-tagged <img>, which is how the Mailchimp/EmailOctopus editor marks
// images placed in the body) in a newsletter's raw HTML.

export function extractLastImage(html) {
  const imgs = (html.match(/<img\b[^>]*>/gi) || [])
    .filter((tag) => /class="[^"]*\bmcnImage\b[^"]*"/i.test(tag));
  const last = imgs[imgs.length - 1];
  if (!last) return null;
  const m = last.match(/\bsrc="([^"]+)"/i);
  return m ? m[1] : null;
}
