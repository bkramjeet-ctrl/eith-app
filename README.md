# Eith

A personal AI companion you chat with — powered by Google's Gemini (free tier), and it remembers things about you as you talk.

- **index.html / styles.css / app.js** — the chat app
- **firebase-config.js** — reuses the same Firebase project already set up for `NoMercyZone-App`, under a separate `eith/` path, so conversations and memory sync across every device you use it on
- **netlify/functions/gemini-proxy.mjs** — a small server-side function that holds the Gemini API key privately, so the site can be shared with other people without exposing it (see **For the site owner** below)
- **netlify.toml** — tells Netlify where the site and the function live

## How it works

- **Chat**: talk to Eith like you would a person. Messages sync live across every device (via Firebase), the same way NoMercyZone-App's group chat does.
- **Conversations**: the title bar under the header shows your current conversation and opens a switcher — like Gemini's or ChatGPT's chat list. Start as many separate conversations as you want (**+ New conversation**), switch between them, or delete one with the 🗑️ button on its row. The first message in a conversation becomes its title automatically. **Eith's memory of you is shared across every conversation** — it doesn't reset per-thread, only the visible chat history does.
- **Memory (💭 button)**: as you talk, Eith notices durable facts about you — your name, preferences, what's going on in your life — and quietly remembers them. Open the 💭 panel any time to see exactly what it knows. This happens automatically; there's no manual editor, by design.
- **"Forget everything"** (in the memory panel) permanently erases what Eith knows about you, everywhere.
- **"Clear this conversation's messages"** (in Settings) wipes the *current* conversation's chat history and resets its title, but leaves Eith's memory of you and your other conversations intact. To remove a conversation entirely, delete it from the conversation switcher instead.
- **Voice input (🎤)**: click the mic to start recording, click again to stop — Eith sends the recording to Gemini for transcription (much more accurate than the browser's built-in speech recognition, especially for names — it used to mishear "Eith" as "eat"), fills in the text, and sends automatically. Recording auto-stops after 60 seconds as a safety cap. Works in any modern browser with microphone access (Chrome, Firefox, Edge, Safari); if unsupported, the mic button stays hidden and Settings shows a note instead of a broken button.
- **Image generation**: ask for one ("make me an image of...", "draw a...") and Eith decides on its own whether to generate it, using a free third-party image API ([Pollinations.ai](https://pollinations.ai) — no key, no cost, not part of Gemini). **It will not generate images of real, identifiable people** — not you, not anyone named, not a public figure — that boundary is written into Eith's own instructions and isn't a setting you can turn off. Ask for that and it'll explain why and offer a fictional/stylized alternative instead. Images may carry a small watermark (anonymous free tier) and can occasionally fail to load if the service is busy — Eith shows a plain error in that case rather than a broken image.
- **Accounts**: sign in with Google to use Eith — each person's conversations and memory are completely private to their own account, enforced by Firebase's security rules (not just hidden in the UI). Nobody signed into a different account can read or write your data, even though everyone's sharing the same deployed site and the same Gemini quota. Your name/avatar and a **Sign out** button live at the top of Settings.

## For anyone using the site (no setup needed)

If someone hands you a link to their deployed Eith, you don't need to do anything — no API key, no account. Requests go through the site's own server, which uses the owner's Gemini key without ever showing it to you. Just open the link and start chatting.

If you'd rather use your **own** free-tier quota instead of sharing the owner's (e.g. if the site is getting a lot of traffic and running into rate limits), you can optionally add your own key: [aistudio.google.com/apikey](https://aistudio.google.com/apikey) → **Create API key** → paste it into **⚙️ Settings**. Entirely optional.

## For the site owner: one-time setup

### 1. Get your Gemini API key

1. Go to [aistudio.google.com/apikey](https://aistudio.google.com/apikey) and sign in with a Google account.
2. Click **Create API key**. No credit card needed for the free tier.
3. Copy the key (starts with `AIzaSy...`). **This one goes on the server, not in Settings** — see step 3.

### 2. Turn on Google Sign-In

In the [Firebase console](https://console.firebase.google.com) → your project (same one as `NoMercyZone-App`, if you've set that up) →:

1. **Build → Authentication** → **Get started** (if you haven't used Authentication on this project before).
2. **Sign-in method** tab → click **Google** → toggle **Enable** → pick a support email (your own is fine) → **Save**.
3. Still under Authentication, go to **Settings → Authorized domains** → **Add domain** → enter your Netlify domain (e.g. `eith.netlify.app`) → **Add**. Without this, sign-in will fail with an "unauthorized domain" error once deployed. (`localhost` is already authorized by default, for local testing.)

### 3. Update your Firebase Realtime Database rules

**Realtime Database → Rules**, replace whatever's there with (merging in anything else you already have, like NoMercyZone-App's `messages` rule):

```json
{
  "rules": {
    "messages": {
      ".read": true,
      ".write": true
    },
    "eith": {
      "conversations": { ".read": true, ".write": true },
      "memory": { ".read": true, ".write": true },
      "migratedTo": { ".read": true, ".write": true },
      "users": {
        "$uid": {
          ".read": "auth != null && auth.uid === $uid",
          ".write": "auth != null && auth.uid === $uid"
        }
      }
    }
  }
}
```

This is the part that actually makes accounts private: `eith/users/$uid` can only be read or written by someone signed in *as that uid* — Firebase enforces this server-side, not just in the app's UI. (The old `eith/conversations` / `eith/memory` paths stay open the same as before, purely so the one-time migration below always works regardless of when you sign in relative to updating these rules — safe to leave as-is, or delete them from the Data tab later once you've confirmed migration worked.)

Click **Publish**.

### 4. Deploy with the key on the server (not drag-and-drop this time)

The whole point of the proxy is that your key lives on Netlify's servers, never in a file that ships to visitors — which means **drag-and-drop deploy (`app.netlify.com/drop`) won't work anymore**, since it doesn't run server-side functions. Use a GitHub-connected deploy instead (also means every future update is just `git push`, no more manually dragging a folder):

1. Create a **new GitHub repository** and push this `Eith-App` folder's contents to it (as the repo root).
2. In [Netlify](https://app.netlify.com), click **Add new site → Import an existing project**, connect your GitHub account, and pick the repo. Leave the build settings as detected (there's no build step — `netlify.toml` already tells it what to publish).
3. Once the site is created, go to **Site configuration → Environment variables** → **Add a variable**:
   - Key: `GEMINI_API_KEY`
   - Value: the key you copied in step 1
4. Trigger a deploy (Netlify usually does this automatically after connecting the repo, or use **Deploys → Trigger deploy**).
5. Visit your new site URL, **sign in with Google yourself first** — this is what claims any pre-account chat history into your account (see the migration note in Limitations) — then send a message to confirm the proxy is working.

**You can now share the URL freely** — nobody can see your key, and nobody can see anyone else's conversations either, since both are enforced server-side now (see the free-tier rate-limit note in Limitations for what sharing the *quota* still means at scale — that part's still shared, only the data is private).

## How to deploy updates after this

Since it's now Git-connected, just commit and push changes to the repo — Netlify redeploys automatically. (Drag-and-drop is off the table specifically because it can't run `netlify/functions/`; if you ever remove the proxy and go back to a pure static site, drag-and-drop works again.)

## Limitations

- **Memory quality**: Eith decides what's worth remembering on its own — it won't be perfect, and there's no way to manually add or edit facts (by design, per how this was set up). If it remembers something wrong, the fix today is "Forget everything" and let it re-learn, or just correct it in conversation (it may pick up the correction as a new memory).
- **No streaming**: replies arrive all at once rather than typing out live.
- **One-time migration, owner signs in first**: if Eith had chat history before accounts existed, the *first* person ever to sign in inherits all of it into their own account (guarded so it only happens once — a second person signing in later gets a clean slate, not someone else's history). In practice this should be you, the owner — sign in right after deploying, before sharing the link with anyone else, so the migration lands on your account.
- **Free-tier rate limits are shared**: the proxy hides your *key*, but everyone using the site (unless they add their own key) still draws from your *one* free-tier quota. Share the link with a handful of people and it'll be fine; share it widely and you'll likely hit rate limits, at which point Eith shows an error bubble rather than failing silently — no charges either way, since there's no billing on the free tier.
- **Model**: uses `gemini-3.6-flash` by default (set in `app.js` near the top, and mirrored as the `model` field sent to the proxy — the proxy itself doesn't hardcode a model). Google retires older Gemini models for new API keys fairly often (we hit this — `gemini-2.5-flash` 404'd as "no longer available to new users"), and the very newest model (`gemini-3.7-flash` as of writing) can return "high demand" (503) errors under free-tier load. If Eith starts erroring on model calls, check the browser console — Google's error message usually names the exact model to switch to.
- **Images are best-effort, not guaranteed**: the free Pollinations API has no uptime guarantee and rate-limits anonymous use (roughly one image per 15 seconds) — asking for several images in a row may cause some to fail to load. There's no retry button yet; just ask again.
- **No real-person image generation, on purpose**: this isn't a technical limitation to work around later — it's a deliberate line. Eith is instructed to refuse generating images of real, identifiable people regardless of who asks or why.
- **No video generation**: not wired up at all — Pollinations only covers images, and Gemini's own video models are paid-tier.
