# WiFi Sentinel

A home movement monitor that runs on your desktop. It listens to the WiFi
signal between your PC and your router. When someone moves through that
signal, it wobbles, and WiFi Sentinel notices.

- Runs on your PC, in the browser: `http://localhost:4780`
- Reachable from your phone over Tailscale
- Big ON / OFF button, green floor plan, movement log
- Alerts by phone push (ntfy) and email
- Needs only Node.js. Nothing else to install, no accounts, no cloud.

## What version 1 can and cannot do (please read)

Version 1 uses only what your PC already has: one number, the WiFi signal
strength, read a few times a second.

**It can:**

- notice movement in the band between your PC and your router (shown glowing
  on the floor plan);
- tell you which rooms that band passes through;
- guess "large" or "small" from how strongly the signal was disturbed.

**It cannot:**

- see movement outside that band. Rooms the band does not cross are **not
  covered**;
- find walls. You draw your floor plan once, by hand, in the app;
- tell which room in the band the movement was in. The figure walks up and
  down the whole band to show "somewhere in here". It does not mark a spot;
- be widened by a setting. Your WiFi reaches the whole home (the rings on
  the map show that), but the app can only listen at one place: the PC. What
  the PC hears most is the path between it and the router. Movement in other
  rooms does bounce the signal a little, but far too little for a PC's rough
  signal reading. Higher sensitivity catches weaker movement inside the
  band; it does not reach other rooms;
- tell a person from a pet. "Small" only means a weaker disturbance. A cat
  near the PC can look bigger than a person far from it;
- promise anything. Signal strength is a rough measure. Expect some false
  alarms (a neighbour's WiFi, a microwave, a door moving) and some misses.
  Treat it as an extra pair of eyes, not as a real alarm system.

Whole-home coverage, real positions and telling people from pets need small
sensor boards. That is version 2, at the bottom of this page.

## How well can my PC sense? (the readings under the chart)

WiFi cards differ a lot. Under the signal chart the dashboard shows what
yours is reporting:

- **"Signal reading changed N times"**: a lively card changes many times a
  minute. If yours changes only a few times, it shows a flat line that jumps
  in steps, and movement is hard to see with it.
- **Link speed** (the dotted line): a second way to notice movement, used
  when "Also watch the WiFi link speed" is ticked in the settings.
- **Keeping the link busy**: with this on, the app sends a tiny packet to
  your router ten times a second while monitoring, so the card keeps its
  readings fresh. It stays inside your home network.
- **Movement level now**: how disturbed signal and speed are, and the level
  at which movement is declared. Each log entry says which of the two
  noticed the movement.

## Start it (Windows)

1. Put this folder somewhere on your E: drive.
2. Double-click **`start.bat`**. The dashboard opens in your browser.
3. Leave the black window open. Closing it stops WiFi Sentinel.

Three things it needs:

- **The PC must be on WiFi.** If it only uses a network cable, there is no
  WiFi signal to listen to. A cable plus WiFi together is fine.
- **Windows location permission.** Newer Windows hides WiFi details unless
  Settings > Privacy & security > Location has "Location services" and "Let
  desktop apps access your location" switched on. The dashboard tells you if
  this is the problem.
- **The PC must stay awake.** Set Windows to never sleep while you are away.

Another port: `node server.js --port 4790`. Port 3001 is refused on purpose.

`try-demo-fake-signal.bat` opens a second copy on port 4781 with a
**made-up** signal and made-up movement, only for looking at the dashboard.
It does not watch your home. It is marked DEMO everywhere and keeps its own
separate log. A layout you draw in the demo is carried over to the real app
the first time you start it.

## First-time setup (about 10 minutes)

1. **Draw your home.** Press "Edit layout". Drag the rooms, rename them, and
   drag ROUTER and PC to where they really are. Save.
   - Out of space? Raise the two "Grid" numbers (up to 80 x 80). You get
     more squares and everything is drawn smaller.
   - Rooms snap to quarter squares and can be as small as half a square.
   - A rough sketch is enough. What matters is that PC and ROUTER sit in the
     right rooms.
2. **Walk test.** Press "Test at home (no alerts)". Wait for the learning to
   finish, sit still for a minute, then walk between the PC and the router.
   Watch the signal chart. If nothing shows, raise the sensitivity in
   "Alerts and settings". If it triggers while nobody moves, lower it, or
   raise "Movement must last at least".
   - The figure stays a few seconds after the movement stops. That is
     normal: the app judges the last 8 seconds of signal.
   - The further apart the PC and router are (a room or two), the more of
     the home the band covers.
3. **Set up alerts** in "Alerts and settings":
   - **Phone push:** install the free "ntfy" app, press "Make one" for a
     topic name, subscribe to that exact name in the app, tick the box.
   - **Email:** your mail provider's SMTP details. For Gmail: server
     `smtp.gmail.com`, port `465`, your address, and an "app password" (made
     in your Google account, not your normal password).
   - Press "Save and send test alert" and check both arrive.
4. **When you leave:** press the big button. You get a countdown (60 seconds
   by default) to get out, then it is ON. Press it again to switch OFF.

If monitoring is ON and the app cannot read the WiFi signal for a minute, it
sends an alert saying so.

## From your phone, over Tailscale

With Tailscale running on the PC and the phone, open
`http://<your PC's Tailscale address>:4780`. The exact address is printed in
the black window and shown at the bottom of the dashboard.

- The dashboard answers only on the PC itself and on its Tailscale address.
  Other devices on your home WiFi cannot open it.
- There is no password page: anyone you let into your Tailscale network can
  open the dashboard and switch it off.
- The first time, Windows may ask whether to allow Node.js through the
  firewall. Allow it for private networks.

## Start with Windows (optional)

Press Win+R, type `shell:startup`, press Enter, and put a shortcut to
`start.bat` in the folder that opens. WiFi Sentinel remembers whether it was
ON, and carries on after a restart (with the countdown again).

## Your data

- Settings, floor plan and the movement log are plain files in the `data`
  folder next to the app. Delete the folder to start fresh.
- The email password is saved there too, on this PC only. It is never shown
  again in the dashboard and `data` is never committed to git.
- Nothing leaves the PC except the alerts you switch on. Push alerts go
  through ntfy.sh (or your own ntfy server) and contain the time and the room
  names. Anyone who knows your topic name can read them, so keep it private.

## What has and has not been tested

Tested (automated, `npm test`, 49 checks):

- the movement detector, on simulated signals;
- reading Windows' WiFi report, from sample text (English and German);
- ON/OFF, the countdown, alert rules, the event log;
- email sending, against a local test mail server (both encryption styles);
- the web protections, and the dashboard itself in a browser with the demo
  signal.

**Not tested yet:**

- on a real Windows PC with a real WiFi card and real people walking. This
  was built on a machine with no WiFi. Your walk test is the first real one;
- real Gmail and the real ntfy.sh service;
- over a real Tailscale connection.

## Version 2 (not built)

Small ESP32-S3 boards (about 10 euros each, 3 to 6 for a home) can read far
more detail from the WiFi signal than a PC can. With one in each area:

- movement in every room, placed in the right room on the floor plan;
- a fairer person / pet guess;
- fewer false alarms.

The app is already built around "links" (one sensor, one path, its own
detector), so version 2 adds more links rather than starting over.

## For developers

No dependencies. `npm test` runs the checks. Code map:

- `server.js`: start-up, ports, Tailscale addresses
- `src/detector.js`: the movement maths
- `src/sensors/`: reading the signal (Windows, Linux, demo)
- `src/engine.js`: ON/OFF, events, alerts
- `src/notify/`: ntfy and email
- `src/http.js`: the dashboard's web server
- `public/`: the dashboard
