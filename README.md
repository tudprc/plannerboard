# PlannerBoard

A school planner that works like an airport departure board. Tasks are **flights**, classes are **airlines**, and each day is a **runway** with a set number of slots, like the lines in a paper planner.

It's a plain web app (HTML, CSS, JavaScript, no build step) that installs to the iPhone home screen and the Mac Dock.

## Screens

| Screen | What it's for |
|---|---|
| **Daily** | Today's departures board. Tap a flight for its details. **+** adds a flight. |
| **Weekly** | The next 7 days on one screen, showing flight numbers only. Tap a day to open it, then add, reorder, or drag flights. |
| **Profile** | Your crew ID (name, photo, callsign, home base, rank), day streak and stats, airlines (IB HL and SL subjects), and settings. |

### Glossary

- **Hangar:** flights with a deadline but no day yet.
- **Turbulence:** how hard a flight is (1–3).
- **Block time:** how long a flight will take.
- **Auto-dispatch:** orders each day's flights for you, using one of three styles: hardest first, warm-up, or due soonest. Anything due today or tomorrow always boards first. The Auto-dispatch button on the Weekly screen also places hangar flights on days before their deadline.
- **Statuses:** every flight is **On time** until you tap **Start boarding** (you're working on it). Then tap **Mark departed** when it's done. A flight you didn't finish rolls over to the next day as **Delayed**, and one past its deadline shows **Late**.
- **Rank:** goes up as flights depart: Cadet, then Second Officer at 10, First Officer at 50, Captain at 150.
- **Appearance:** light from sunrise to sunset in Qingdao, dark at night. The app works out sunrise and sunset itself (`js/theme.js`) and checks every minute. You can lock it to light or dark in Profile → Appearance.
- **Block time** is optional. Pick "Not sure" if you don't know.

## Run it on your Mac

```bash
node serve.mjs
```

Then open http://localhost:8420.

## Data

Flights are saved in the browser on each device (localStorage). Settings → Backup exports a file that you can import on another device. Sync between devices is planned.
