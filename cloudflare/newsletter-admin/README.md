# Newsletter admin

A small page where Tom manages two things on the site:

- **♥ Best of:** he picks articles from inside the issues. They're listed on
  `best-of.html` (browsable by year, with search), and one at random shows
  under the random meme on the archive. He can tidy each title and add an
  optional note. Saved to `emails/best-of.json`.
- **Memes:** he browses every meme and hides any he doesn't want on the memes
  page or as the archive's random meme. Saved to `emails/hidden-memes.json`.
  Hiding is reversible and survives the weekly rebuild of `emails/memes.json`.
  It doesn't touch the original issue email, where the meme still appears.

Saving commits the file to this repo. GitHub Pages republishes the site, and
the change shows up about a minute later.

It runs as a Cloudflare Worker on Tom's Cloudflare account. Cloudflare Access
sits in front of it, so you log in with an emailed one-time code: there's no
password and no GitHub account needed.

**Nothing secret is in this repo.** The GitHub token and the list of allowed
emails are Cloudflare secrets. The Worker refuses every request until Access
is set up, and it also checks the Access login itself, so a mistake in the
dashboard can't open up the save button.

## One-time setup (about 20 minutes)

You'll need Node 18+ and to be logged in to GitHub as someone who can push to
`technoqueers/technoqueers.github.io`.

### 1. Get into Tom's Cloudflare account

Ask Tom to invite you: **Cloudflare dashboard → Manage Account → Members →
Invite**, with the **Administrator** role. That way he never has to share his
password. Accept the invite from your email.

### 2. Make a GitHub token that can only edit this repo

GitHub → **Settings → Developer settings → Personal access tokens →
Fine-grained tokens → Generate new token**:

- **Resource owner:** `technoqueers`. If it isn't listed, an org owner has to
  allow fine-grained tokens under the org's **Settings → Personal access
  tokens**.
- **Expiration:** the longest you're comfortable with. Put a reminder in your
  calendar to renew it (see "Renewing the token" below).
- **Repository access:** *Only select repositories* → `technoqueers.github.io`
- **Permissions → Repository → Contents:** *Read and write*. Leave everything
  else at no access.

Copy the token. You'll paste it in step 5, and you won't see it again.

### 3. Deploy the Worker

```bash
cd cloudflare/newsletter-admin
npm install
npx wrangler login        # opens a browser; pick Tom's account
npx wrangler deploy
```

It prints a URL like `https://technoqueers-admin.<something>.workers.dev`.
That's the admin page. For now it only says "Not signed in: admin is not
configured yet", which is expected.

### 4. Put Cloudflare Access in front of it

1. Dashboard → **Workers & Pages → technoqueers-admin → Settings → Domains &
   Routes**. On the `workers.dev` row, choose **Enable Cloudflare Access**. If
   this is the account's first time using Zero Trust, Cloudflare asks you to
   pick a team name and the **Free** plan. It may ask for a card, but the free
   plan isn't charged.
   If your dashboard doesn't show that option, create the application by hand
   instead: **Zero Trust → Access → Applications → Add an application →
   Self-hosted**, using the workers.dev hostname from step 3.
2. Open the Access application it created (**Zero Trust → Access →
   Applications**) and edit its policy. Set **Include → Emails** to Tom's email
   and yours, and remove any other rules.
3. Check **Zero Trust → Settings → Authentication**: **One-time PIN** should
   be listed as a login method. It's on by default.
4. Note two values:
   - **Team domain**: `<team name>.cloudflareaccess.com`, using the team
     name from step 1. It's also shown under **Zero Trust → Settings**.
   - **Application Audience (AUD) tag**: on the application's **Overview**
     tab

### 5. Configure and redeploy

Put the two values into `wrangler.toml` (they aren't secret) and commit them:

```toml
ACCESS_TEAM_DOMAIN = "technoqueers.cloudflareaccess.com"
ACCESS_AUD = "<the AUD tag>"
```

Then add the secrets. Each command asks you to paste the value:

```bash
npx wrangler secret put GITHUB_TOKEN      # the token from step 2
npx wrangler secret put ALLOWED_EMAILS    # e.g. tom@example.com,you@example.com
npx wrangler deploy
```

`ALLOWED_EMAILS` should match the Access policy. It's a second lock in case
the policy is ever loosened by mistake.

### 6. Try it, then send Tom the link

Open the workers.dev URL in a private window. You should get a Cloudflare
login page; enter your email, then the code from your inbox. Tick an issue,
save, and check that a commit called "Update best-of picks" lands on master
and the archive shows it. Then untick it, save again, and send Tom the link.

## What Tom does

1. Open the link (worth bookmarking) and enter his email, then the code that
   arrives. He stays logged in for a day by default; you can change that on
   the Access application.
2. On **♥ Best of**, search every issue's full text (or scroll), open an
   issue, and click ♥ next to an article. Event listings are tucked away
   unless he ticks "Show event listings too". His picks appear at the top,
   where he can tidy the title, add a note, or click ♥ again to remove one.
3. On **Memes**, click **Hide** on any meme to take it off the site, or
   **Unhide** to bring it back. The filter shows just the hidden ones.
4. Click **Save**. The site updates in about a minute.

## Maintenance

- **Renewing the token:** make a new one (step 2), run
  `npx wrangler secret put GITHUB_TOKEN`, and delete the old one on GitHub.
  Until then saving fails with "GitHub save failed (401)", but the site itself
  keeps working.
- **Adding or removing an editor:** update both the Access policy and
  `ALLOWED_EMAILS`.
- **Code changes:** edit `src/`, then run `npx wrangler deploy`. Pushing to
  GitHub doesn't deploy the Worker.
- **Hidden memes by hand:** `emails/hidden-memes.json` is a list of image
  URLs, copied from `emails/memes.json`.
- **Editing by hand still works:** `emails/best-of.json` is a plain list of
  `{ "issue": "<filename in emails/>", "url": "<article link>", "title": "…",
  "note": "…" }` (note optional). The archive shows picks newest issue first,
  whatever their order in the file. Issues are named by filename because
  older entries in `emails/data.json` have no id.
- **How articles are found:** the admin page loads the issue from the public
  site and lists every outbound link with the line it sits in. Issue layouts
  changed over the years, so it doesn't try to be clever: Tom decides what's
  an article. Lines with a time range like `[10p-4a]`, or links to ticket
  sites, are treated as event listings.
