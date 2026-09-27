# hedgehog

A Pikkit-style bet tracker and live college football dashboard. Bets come first; scores, schedule, lines and news sit behind them.

No build step, no dependencies, no backend. It's plain ES modules that call ESPN's public feeds straight from the browser.

## Run it

```sh
npm start          # serves on http://localhost:5173
npm test           # odds math, grading, ESPN parsing
```

Any static server works (`python3 -m http.server`). Opening `index.html` from `file://` won't work, because browsers block ES modules there.

To try it without real bets, open **Settings → Demo mode**. It loads a simulated slate where games kick off, go live and go final while you watch (6× speed), plus about 40 sample bets. Demo data is stored separately from your real bets.

## What's in it

| Tab | What it does |
| --- | --- |
| **Bets** | Net P/L, ROI, record, streak and a profit curve. **Sweating now** shows every open leg on a live game with its score and where it stands ("Covering by 3.5", "Need 9 more"). Open and settled bets are grouped by day. **Insights** breaks results down by bet type, market, odds range and book, and compares your win rate with the break-even rate for your average odds. |
| **Live** | Today's FBS scoreboard: live games first, then games with your action. Shows possession, down and distance, and red-zone highlighting. It refreshes every 20s while anything is live and every 2 min otherwise. |
| **Upcoming** | Tomorrow through the next four weeks, grouped by day, in your local time zone. It re-checks every 10 minutes. If a kickoff moves or a TBD game gets a time, the game is flagged with its old time. |
| **Build** | A sportsbook-style board (spread / total / moneyline) built from ESPN's posted lines. Tap prices to build a slip. You can switch between straights and a parlay, nudge any price, enter the book's own SGP price, add a boost, and add custom props. When a line moves, the slip tells you and offers **Use market**. **Market sim** makes prices drift on purpose so you can see how a ticket reprices. **Track** saves the slip to Bets. |
| **News** | ESPN CFB headlines, auto-tagged as Injury / Lines & odds / Interviews / Look-ahead / Rankings / Portal. The tab also has a **line moves** feed built from every line hedgehog has seen, and a **My teams** filter for teams in your open bets. |

**Add a pick** logs any bet from any book:

- Straight or parlay.
- Odds in any format: `+800`, `-110`, `2.5`, `x9.3`, `5/2`. Use the ± buttons or arrow keys to step them. On the American scale, stepping moves across the -100/+100 gap the way books do.
- Stake and to-win are linked, so you can fill in either one.
- Optionally link a leg to a game. Linked legs track live and **auto-grade from the final score**.

Open bets have manual grading per leg, cash-out, a hedge calculator and notes.

**Ghost bets.** Flip on **Ghost bet** when adding a pick or tracking a slip (or use "Make it a ghost" on any bet) to follow a pick you're *not* placing.
- Ghosts track live and auto-grade like real bets, but never count toward your profit, record or Insights.
- The **Ghosts** tab shows your passes' record, what they'd be up or down, how much you dodged, and whether your passes are beating your real bets.

**Parlay autopsy** (Insights) breaks down your settled parlays:
- how many losses missed by a single leg, and the payout you missed
- how many died on the last leg to play
- which kind of leg misses most
- what the same money would have made as straight bets
- hit rate by parlay size against what the odds implied

A lost parlay's detail view also names the leg or legs that sank it.

**Share & tail.** Tap **Share** on any bet, or **Share** on the Build slip for picks you haven't placed yet.
- You get a link plus a share-card image, through the iPhone share menu or copied to the clipboard.
- Your stake is hidden unless you turn it on.
- Friends who open the link see your ticket with live scores, then **Tail it** (the Add form opens filled in, so they just add a stake) or **Ghost it**.
- Nothing goes through a server: the ticket is encoded in the link, and everything decoded from a link is validated and escaped.
- Tailed bets are tagged with who they came from, and Insights adds a **By source** table showing whose picks make you money.

**Friends leaderboard** (needs accounts, plus [`supabase/friends.sql`](supabase/friends.sql) run once in Supabase).
- Create a private group and send the invite link (or 6-character code).
- Everyone's record, profit in **units** (so different bankrolls compare fairly) and ROI rank for this week, this month and the season, with streaks.
- Tap a friend to see their stats and **open picks**, which you can tail in one tap.
- Stakes are never shared, ghost bets don't count, and "Show my open picks" can be turned off.
- Each member's app publishes its own summary, so it's an honor system among friends.
- Demo mode shows a pretend group.

**Alerts** (Settings → Alerts). Notifications for parlay legs hitting, bets cashing, losing or pushing, kickoffs of your games, and your team reaching the red zone. Each type can be turned off, including ghost-bet alerts.
- **While hedgehog is open or in the background:** works out of the box once you allow notifications. On iPhone, hedgehog must be added to the Home Screen first.
- **With hedgehog closed:** a GitHub Actions job ([`scripts/alerts-worker.mjs`](scripts/alerts-worker.mjs), every ~5 min) checks signed-in users' open bets against ESPN final scores and sends Web Push.
  - Results usually arrive 5–15 minutes after the final. Red-zone alerts are in-app only because they'd arrive too late.
  - Each alert is sent once, and devices that stop accepting alerts are removed.
  - Setup: run [`supabase/alerts.sql`](supabase/alerts.sql), then add the repository secret `SUPABASE_SECRET_KEY` (the Supabase secret / service_role key). The push signing keys are created on the first run and stored in Supabase.

**Import a slip.** Drop a screenshot onto the page, paste one, or pick one from your photos. You can also paste the share text or link your book gives you.
- Screenshots are read in the browser with [Tesseract.js](https://github.com/naptha/tesseract.js). It's downloaded from jsDelivr the first time (~12 MB), and the image never leaves your device.
- hedgehog pulls out the book, legs, odds, stake and payout, and matches each pick to a real game so it tracks live and auto-grades. You review everything before it's saved.
- Share links can't be read directly, because books require a login, but the link is saved on the bet.

**Ticket payout.** Books don't always pay exactly what the leg odds multiply to. They round each leg's price, price same-game parlays with their own correlation math, and prices can move between building a slip and placing it. Enter the payout printed on your ticket, either when adding the bet or later from the bet's detail view. hedgehog will use that number and show how far off the leg math was.

## Player props

Type or import a prop the way books write it:
- "Josh Allen over 250.5 passing yards", "J. Allen o250.5 pass yds"
- "Kelce 6+ receptions", "Derrick Henry anytime TD", "Bijan Robinson rush + rec yards u110.5"

hedgehog reads the player, stat, over/under and line.

- **Tracking:** live progress comes from ESPN's box score ("142 / 224.5 pass yds · on pace for 304"), with a progress bar on the bet card.
- **Settling:** the prop settles itself from the final box score, and closed-app alerts fire for it too.
- **Finding the game:** from a team in the pick or the slip's matchup line. If neither names one, hedgehog searches that day's box scores for the player once games start. It only links when exactly one game has that player, so it never guesses.
- **Stats covered:**
  - passing: yards, TDs, completions, attempts, interceptions
  - rushing: yards, attempts, TDs
  - receiving: receptions, yards, TDs
  - combined: rush + rec yards, pass + rush yards
  - anytime TD
- **When it won't settle:** a player missing from the final box score stays open for you to settle by hand. It's never auto-voided.

## College football and NFL

The **CFB | NFL** switch in the header swaps Live, Upcoming, Build and News between leagues. Your choice is remembered on each device.

Bets, stats, friends and alerts cover both leagues at once. Every linked pick remembers its league, so an NFL bet keeps tracking and settles itself while you're looking at college games (and the other way round). The same goes for the iPhone widget and closed-app alerts. Picks saved before this change count as college football.

## Accounts & sync (optional)

Create an account with your email and a password, and your bets and settings stay in sync across your phone and computer.
- Bets are saved on the device first, so the app still works offline and syncs when you're back online.
- If the same bet is edited on two devices, the most recent edit wins, and deletes carry over to every device.
- Every account can only see its own data (the database enforces this with row-level security).
- Password sign-in works the same in the iPhone home-screen app. An emailed sign-in link would open Safari instead of the app.

With `js/config.js` left empty, the app runs local-only, exactly as before.

**One-time setup:**
1. Create a free project at [supabase.com](https://supabase.com).
2. In **SQL Editor**, paste all of [`supabase/schema.sql`](supabase/schema.sql) and click **Run**.
3. In **Authentication → URL Configuration**, set **Site URL** to `https://masonhainey.github.io/betting-proj/`. The sign-up confirmation and password-reset links come back here.
4. From **Project Settings → API Keys**, copy the **Project URL** and the **anon / publishable** key into `js/config.js`. That key is safe to put in public code; never use the `service_role` / secret key.

To skip the confirmation email on sign-up, turn off **Authentication → Sign In / Providers → Email → Confirm email**. That's reasonable for a personal app.

## iPhone widgets (Scriptable)

Your open bets on the Home Screen (small, medium, large) and Lock Screen (inline, rectangular, circular), with live status for each bet, today's result, and money at risk and to win. It refreshes about every 5 minutes while your games are on and in time for the next kickoff otherwise. iOS decides the exact timing.

Setup is in **Settings → Home Screen widget**. Copy the installer, paste it into a new script in the free [Scriptable](https://scriptable.app) app, run it once to sign in, then add a Scriptable widget and pick that script.

- The installer is a short loader. Each run it downloads `widget/hedgehog-widget.js` from this site and keeps a copy for offline use, so widget updates arrive with the site.
- The widget signs in with its own session, so it never signs the app out. Your email and password are stored in the iPhone Keychain.
- If a refresh fails, it shows the last good data with a ⚠︎ and the time.
- Games that finished before you opened the app are graded in memory, so the widget is current even when the app hasn't graded them yet.
- The source is in `widget/src/` and reuses the app's own grading and ESPN code. Rebuild with `npm run build:widget` (CI checks the committed bundle is up to date).

## How it holds up when feeds fail

- Schedule requests go out a week at a time. If one fails, that week is fetched day by day, and games already on screen for a day that fails stay there.
- The last good slate is cached in `localStorage` and shown right away on load.
- Failed feeds retry every 45 seconds, with a visible "showing data from X ago" note. Polling pauses while the tab is hidden.

## Layout

```
index.html, styles.css, manifest.webmanifest, sw.js (offline shell for the installed app)
js/app.js          entry point: boot
js/state.js        shared state, settings, save helpers, DOM utilities (imports no app modules)
js/data.js         ESPN/demo refresh, caching, kickoff + line tracking, auto-grading, polling
js/market.js       odds board markets, market sim, bet slip
js/account.js      accounts & sync controller + account UI
js/render.js       top-level render, sheet host, shared UI components
js/events.js       click/input/keyboard handlers, drag & drop, paste, routing
js/views/*.js      Bets, Live, Upcoming (schedule), Build, Friends, News tabs
js/sheets/*.js     game, bet, add-a-pick, import, settings sheets
js/espn.js         ESPN fetch + normalization (handles both odds formats ESPN has shipped)
js/odds.js         American/decimal/fractional parsing, stepping, parlay, hedge, no-vig
js/grade.js        bet model, live leg status, auto-grading, stats
js/autopsy.js      ghost bets report + parlay autopsy
js/share.js        share-link encode/decode (validated) + share text
js/leaderboard.js  stats each member publishes + ranking
js/friends.js      groups, members, publishing (Supabase)
js/alerts.js       notification permission, local alerts, push subscription
js/alertrules.js   what triggers an alert and its wording (shared with the worker)
scripts/           alerts-worker.mjs (scheduled push sender)
widget/src/        Scriptable widget: model.js (what to show, pure) + core.js (sign-in, fetch, drawing)
widget/hedgehog-widget.js  bundled widget the installer downloads (generated)
js/widget.js       the Scriptable installer text
js/sharecard.js    share-card image (canvas)
js/slipparse.js    bet-slip text → draft bet; matches picks to games
js/ocr.js          lazy-loaded Tesseract.js OCR with dark-mode image cleanup
js/cloud.js        Supabase sign-in (email + password) + records table over fetch
js/sync.js         local-first sync: change detection, tombstones, last-write-wins merge
js/config.js       Supabase project URL + publishable key
js/news.js         headline tagging
js/demo.js         simulated data source with the same interface as espn.js
supabase/          schema.sql (sync), friends.sql (leaderboard), alerts.sql (push) to paste into Supabase
tests/             node --test
```

`npm run lint` checks every module for undefined names and unused imports; CI runs it with the tests.

Without an account, bets are stored only in the browser. Use **Settings → Export/Import JSON** to back them up or move them between devices.
