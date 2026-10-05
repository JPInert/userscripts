# userscripts

Small browser userscripts I use every day: canned replies with an AI rewrite for Zendesk, a clipboard history that follows me across every tab, and a read-only Walmart shopping list helper.

> **Status: work in progress.** These run in my browser daily and still change. The Walmart one was written for my own list first, so expect to edit the list for yours.

| Script | What it does |
|---|---|
| [canned-responses.user.js](canned-responses.user.js) | A snippet library for the Zendesk agent workspace reply box: store, edit, pin, search and insert canned replies, with optional "Revise" through a local model server that you can always revert. |
| [clipboard_scratchpad.user.js](clipboard_scratchpad.user.js) | A small draggable panel on every page with your last 100 copies (Ctrl+C or right-click Copy) and an autosaving notes field. Click an entry to copy it again. Synced live across tabs. |
| [walmart_mealplan_list.user.js](walmart_mealplan_list.user.js) | Walks a fixed shopping list on walmart.com one item at a time, highlights the matching product, and checks the cart against the list. Read-only: you click Add. |

Also mine, published separately: **[gmaps-layers](https://github.com/JPInert/gmaps-layers)**, a Google Maps userscript that finds X within N miles of each Y (for example food near Superchargers).

## Why I built it

**Canned responses.** I answer a high volume of support tickets in Zendesk, and many replies are close variations of the same few answers. I wanted fast, consistent replies a click away, plus an AI rewrite of my draft that never clobbers what I typed.

**Clipboard scratchpad.** I move IDs, names and snippets between half a dozen web tools all day, and the system clipboard holds exactly one thing. I wanted every copy kept, one click to reuse it, and a scratch notes field that's on whatever tab I'm in.

**Walmart shopping pilot.** We buy a costed monthly meal plan for two at Walmart, two shops a month. Typing each item into search and checking size and price by hand went wrong in small ways: a wrong size, a near-miss product, an item forgotten. This walks the list for me and audits the cart before checkout.

## How it works


### Canned responses

- Runs only on `https://*.zendesk.com/agent/*`. A draggable panel with **Insert** and **Manage** tabs; click the side tab to collapse it. Position and the open tab are remembered.
- **Snippets** have a title, tags and a body. Search matches all three. Pinned snippets sort to the top. Export and import as JSON (import adds new ones and updates matching IDs). Three neutral examples are added on first run; edit or delete them.
- **Links**: write bare URLs or Markdown `[text](url)` in a snippet. They become real links when inserted. In the editor, select text and paste a URL to wrap it as a link.
- **Inserting**: Zendesk's reply box is CKEditor 5, which keeps its own document model. Typing into the page, `execCommand`, or a synthetic paste with only plain text is ignored. The script sends a paste event that carries HTML, which CKEditor accepts through its own clipboard handling, so the snippet lands at the cursor with its line breaks and links.
- **Simplify** (sparkle button next to the composer's mic): opens Zendesk's own "Enhance writing" menu and presses Simplify. Zendesk's built-in AI does the rewrite; the script only presses its buttons. Needs that feature on your Zendesk plan.
- **Revise** (panel button, or the second button next to the mic): sends the current draft to a local server you run, and puts the reply in the box.
  - If you edit the draft while the request is running, the result is thrown away and you are told. It never overwrites typing.
  - **Revert** restores your original draft. Originals are kept per editor, because Zendesk keeps several tickets' reply boxes open at once; Revert on one ticket can never paste another ticket's text. Revising twice still reverts to what you first wrote. If you edited after revising, Revert asks first.
- **Page functions** for an outside automation (for example a Playwright script calling `page.evaluate`). They use your own logged-in Zendesk on the same site:
  - `insertCannedResponse(title)` inserts a snippet at the cursor.
  - `insertCannedResponsePipeline(title)` replaces the draft with the snippet, sets the greeting and sign-off from settings, then removes any CC or follower that matches the "remove CC" setting.
  - `mergeRelatedTickets(requesterEmail, keywords)` finds the same requester's other open tickets (optionally only subjects containing a keyword) and merges them into the current ticket.
  - `mergeDuplicates(ticketIds)` merges a list of ticket IDs you already picked.
  - Both merge functions **always show a confirm dialog** listing each ticket number and subject first. Merging closes tickets and cannot be undone, so nothing merges without a person clicking OK. Merge notes are internal, not public.

#### Settings (Manage tab, bottom)

| Setting | Default | What it does |
|---|---|---|
| Revise server URL | `http://127.0.0.1:8765` | Where Revise sends the draft. Any port you like. Blank turns Revise off (the buttons stay and say no server is set). |
| Revise instructions | a generic "tighten this reply, keep every fact and link" prompt | Sent to the server with each request. |
| Pipeline greeting | `Hi there,` | Replaces the snippet's opening line in the pipeline insert. |
| Pipeline signature | `Best,` / `Your support team` | Replaces the snippet's closing in the pipeline insert. |
| Remove CC/follower matching | blank | An email (exact) or part of a name. Matching CCs and followers are removed by the pipeline insert, for example your team's shared address. Blank removes nobody. |

#### The Revise server

Not included: bring your own. It must accept:

```
POST /api/revise
{"html": "<p>draft</p>", "greeting": "Good Morning,", "instructions": "..."}
```

and answer `{"ok": true, "html": "<p>revised</p>", "duration_ms": 1234}`, or `{"ok": false, "error": "..."}`. It must allow CORS from your Zendesk origin. The whole draft is sent as written, so run it on your own machine and only send what your workplace allows.

### Clipboard scratchpad

- Listens for the page's native `copy` event, so it captures Ctrl+C and right-click Copy without asking for clipboard read permission. Keeps the last 100 entries with time and site.
- **Cross-tab sync, two ways.** Changes are pushed to every open tab through the userscript manager's value-change events. Those don't reliably reach background, frozen or back/forward-cached tabs, so each tab also re-reads storage whenever it becomes visible or gets focus.
- **Never wipes another tab's work.** Before deleting or clearing, it re-reads storage first, so a tab with a stale copy can't save over entries other tabs added. Notes don't overwrite you mid-typing.
- **Safe rendering.** Copied text is shown with `textContent`, never as HTML, so copying markup or script-looking text can't inject anything into the panel.
- Pause capture, clear with a confirm, drag to move (position remembered), click the header to collapse.

### Walmart shopping pilot

- Runs only on Walmart search, browse, product and cart pages.
- **Walking the list**: its panel shows the current line, searches for it when you press a button, scores the result tiles against the expected title (with "reject words" so, for example, mild salsa never matches medium), and scrolls to and outlines the best match. You click Add, then press **Added** to log it and move on.
- **Cart audit**: on the cart page it reads the cart and lists each line as present, wrong product, wrong quantity or missing, plus anything in the cart that is on no list. It can walk only the flagged lines.
- **Blocks**: the plan is two shops a month on a rotating menu, so the list changes per shop; a one-time "setup" list holds things bought once.
- **It never clicks, submits or fetches anything on walmart.com.** It reads the DOM of pages you opened and only navigates when you press a button in its panel. Walmart blocks automated browsing, and every cart change stays a human click.
- State (where you are in the list, what you logged) is kept in the userscript manager's storage.

## Install

It runs on desktop Chrome, Edge, Firefox and Firefox-based browsers, through a userscript manager extension. Two minutes, once.

### 1. Install a userscript manager

Pick one. Violentmonkey is free and open source; Tampermonkey is the most widely used.

| Browser | Extension |
|---|---|
| Chrome, Brave | [Violentmonkey](https://chromewebstore.google.com/detail/violentmonkey/jinjaccalgkegednnccohejagnlnfdag) or [Tampermonkey](https://chromewebstore.google.com/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobfkfo) |
| Edge | [Violentmonkey](https://microsoftedge.microsoft.com/addons/detail/violentmonkey/eeagobfjdenkkddmbclomhiblgggliao) or [Tampermonkey](https://microsoftedge.microsoft.com/addons/detail/tampermonkey/iikmkjmpaadaobahmlepeloendndfphd) |
| Firefox, LibreWolf | [Violentmonkey](https://addons.mozilla.org/firefox/addon/violentmonkey/) or [Tampermonkey](https://addons.mozilla.org/firefox/addon/tampermonkey/) |

### 2. Chrome and Edge only: allow user scripts

Recent versions of Chrome and Edge block userscripts until you switch them on for the extension:

1. Open `chrome://extensions` (or `edge://extensions`).
2. Click **Details** on Violentmonkey or Tampermonkey.
3. Turn on **Allow User Scripts**. On older versions that have no such toggle, turn on **Developer mode** at the top right of the extensions page instead.

Firefox needs nothing extra.

### 3. Install the script

Open the raw file. The extension recognises the `.user.js` file and shows an install page; click **Install** (or **Confirm installation**).

- **[canned-responses.user.js](https://raw.githubusercontent.com/JPInert/userscripts/main/canned-responses.user.js)**
- **[clipboard_scratchpad.user.js](https://raw.githubusercontent.com/JPInert/userscripts/main/clipboard_scratchpad.user.js)**
- **[walmart_mealplan_list.user.js](https://raw.githubusercontent.com/JPInert/userscripts/main/walmart_mealplan_list.user.js)**

To update later, the extension checks for new versions on its own, or open the install link again. To remove one, delete it from the extension's dashboard.

## Running it

### Walmart shopping pilot

1. Edit the `LIST` (and `SETUP`) arrays at the top of the script for your own groceries: quantity, exact Walmart title, expected price for the line, a short search query, and reject words.
2. Open walmart.com and search for anything. The panel appears at the bottom right; use it to walk the list, and click Walmart's own **Add** button yourself.
3. Open the cart to see the audit before you check out.

## What I checked

- `node --check` passes on all three scripts.
- Clipboard scratchpad: I run it daily across many tabs; this published copy differs only in its header. Tested in headless Chromium with stand-in storage: two copies are captured newest first, and copied `<img onerror>` markup shows as plain text and never runs.
- Walmart: it only reads pages you opened, with no clicks, submits or requests on walmart.com.
- Walmart, not checked for this published version: the current page layout. My own copy runs on my shops; treat the first run of this file as untested.

**Canned responses:**

- `node --check` passes.
- The repo scanner finds no secrets, private IPs, paths or names. Its only hits are the word "Zendesk", which is the product it runs on.
- A small Node harness with stubbed browser objects ran the page functions: the pipeline insert sets the greeting, links and signature; CC removal does nothing when the setting is blank and removes only the match when set; both merge paths send nothing when the confirm is declined, and merge after OK.
- **Not checked here:** I could not test this against a live Zendesk. The panel, Insert, Revise, Revert and Simplify were not run in a browser for this version. Zendesk's page selectors (`data-test-id` names, CKEditor classes) are whatever Zendesk shipped when I wrote it and can change. Snippet storage moved from my own server to the userscript manager's storage for this public version, and that code is new.

## Built with Claude Code

I built and debugged this with Claude Code as my pair.

## License

MIT
