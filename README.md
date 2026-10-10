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

## Sync and widgets

Flights are saved on each device and synced through Supabase (free), which also powers the home-screen widgets.

**One-time setup**

1. Create a free project at [supabase.com](https://supabase.com).
2. Go to **SQL Editor → New query**, paste [`supabase/setup.sql`](supabase/setup.sql), and click **Run**.
3. Go to **Authentication → Sign In / Providers → Email** and turn off **Confirm email**. You can leave it on, but then you'll need to click a link in an email before your first sign-in.
4. Go to **Project Settings → API**, copy the **Project URL** and the **publishable key**, and either:
   - put them in [`js/config.js`](js/config.js), so every device is already connected, or
   - paste them into PlannerBoard → **Profile → Sync and widgets → Connect**.
5. Create an account in the app on one device, then sign in with the same email and password on the others.

**Widgets** (iPhone, and on the Mac desktop via iPhone widgets in macOS Sonoma or later)

1. Install **Scriptable** (free) from the App Store.
2. In PlannerBoard, open **Profile → Sync and widgets → Copy widget script**.
3. In Scriptable, tap **+**, paste the script, and name it "PlannerBoard".
4. Long-press the Home Screen (or Lock Screen), add a **Scriptable** widget in any size, tap it to edit, and choose the **PlannerBoard** script.

| Widget | Shows |
|---|---|
| Small | The next departure (or the flight that's boarding) |
| Medium | Today's board: the next three flights |
| Large | Today's board, tomorrow's flights, and upcoming deadlines |
| Lock Screen, rectangular | Next flight, status, and how many are left |
| Lock Screen, circular | Ring showing today's progress and flights left |
| Lock Screen, inline | One line above the clock |

The widgets refresh about every 15 minutes (iOS decides exactly when), switch light and dark with the Qingdao sun, and keep showing the last board when you're offline.
