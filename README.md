# userscripts

Small browser userscripts I use every day. The first one here walks a grocery list on Walmart; more will be added.

> **Status: work in progress.** It runs in my browser and still changes often. It was written for my own list first, so expect to edit the list for yours.

| Script | What it does |
|---|---|
| [walmart_mealplan_list.user.js](walmart_mealplan_list.user.js) | Walks a fixed shopping list on walmart.com one item at a time, highlights the matching product, and checks the cart against the list. Read-only: you click Add. |

Also mine, published separately: **[gmaps-layers](https://github.com/JPInert/gmaps-layers)**, a Google Maps userscript that finds X within N miles of each Y (for example food near Superchargers).

## Why I built it

**Walmart shopping pilot.** We buy a costed monthly meal plan for two at Walmart, two shops a month. Typing each item into search and checking size and price by hand went wrong in small ways: a wrong size, a near-miss product, an item forgotten. This walks the list for me and audits the cart before checkout.

## How it works

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

- **[walmart_mealplan_list.user.js](https://raw.githubusercontent.com/JPInert/userscripts/main/walmart_mealplan_list.user.js)**

To update later, the extension checks for new versions on its own, or open the install link again. To remove one, delete it from the extension's dashboard.

## Running it

### Walmart shopping pilot

1. Edit the `LIST` (and `SETUP`) arrays at the top of the script for your own groceries: quantity, exact Walmart title, expected price for the line, a short search query, and reject words.
2. Open walmart.com and search for anything. The panel appears at the bottom right; use it to walk the list, and click Walmart's own **Add** button yourself.
3. Open the cart to see the audit before you check out.

## What I checked

- `node --check` passes.
- It only reads pages you opened: no clicks, submits or requests on walmart.com.
- Not checked for this published version: the current Walmart page layout. My own copy runs on my shops; treat the first run of this file as untested.

## Built with Claude Code

I built and debugged this with Claude Code as my pair.

## License

MIT
