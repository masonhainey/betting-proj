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

**Import a slip.** Drop a screenshot onto the page, paste one, or pick one from your photos. You can also paste the share text or link your book gives you.
- Screenshots are read in the browser with [Tesseract.js](https://github.com/naptha/tesseract.js). It's downloaded from jsDelivr the first time (~12 MB), and the image never leaves your device.
- hedgehog pulls out the book, legs, odds, stake and payout, and matches each pick to a real game so it tracks live and auto-grades. You review everything before it's saved.
- Share links can't be read directly, because books require a login, but the link is saved on the bet.

**Ticket payout.** Books don't always pay exactly what the leg odds multiply to. They round each leg's price, price same-game parlays with their own correlation math, and prices can move between building a slip and placing it. Enter the payout printed on your ticket, either when adding the bet or later from the bet's detail view. hedgehog will use that number and show how far off the leg math was.

## How it holds up when feeds fail

- Schedule requests go out a week at a time. If one fails, that week is fetched day by day, and games already on screen for a day that fails stay there.
- The last good slate is cached in `localStorage` and shown right away on load.
- Failed feeds retry every 45 seconds, with a visible "showing data from X ago" note. Polling pauses while the tab is hidden.

## Layout

```
index.html, styles.css
js/app.js     state, polling, views, events
js/espn.js    ESPN fetch + normalization (handles both odds formats ESPN has shipped)
js/odds.js    American/decimal/fractional parsing, stepping, parlay, hedge, no-vig
js/grade.js   bet model, live leg status, auto-grading, stats
js/news.js    headline tagging
js/slipparse.js  bet-slip text → draft bet; matches picks to games
js/ocr.js     lazy-loaded Tesseract.js OCR with dark-mode image cleanup
js/demo.js    simulated data source with the same interface as espn.js
tests/        node --test
```

Bets are stored only in the browser. Use **Settings → Export/Import JSON** to back them up or move them between devices.
