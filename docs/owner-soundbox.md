# Owner Soundbox: how new-order alerts work

Status: **built and verified on a real phone** (OPPO / ColorOS, release build, screen off), October 2026.

The shop owner's phone rings and reads out every new order, like a payment soundbox. It works with the app open, with the
screen off, and with the app closed. This file is the record of how it works, how to build and test it, and every
mistake we made getting there, so nobody (human or AI) has to rediscover them.

The owner panel itself is part of the customer app (`mobile/`): a user whose role is `admin` lands on the owner tabs
(`mobile/src/navigation/OwnerNavigator.jsx`). The Soundbox is the first piece built for it.

---

## 1. What the owner experiences

| Situation | What happens |
|---|---|
| **App open, Soundbox on** | Bell, then the order read out loud (greeting first, once), then quiet for the chosen "Repeat every", then again, until he opens the order or someone accepts it. |
| **Screen off or app closed** | The phone plays a 3.5 s clip "New order received" and vibrates. About 4 to 10 s later the app reads the full order out loud (his voice, language and greeting), **without him touching the phone**. |
| **He taps the notification** | The app opens on the order and reads it out. |
| **Soundbox off** | No new-order sound anywhere (not in the app, not from the push). A normal silent notification still appears. |

Settings (phone-local, never sent to the server except the on/off flag): Soundbox mode, repeating chime, volume, repeat time,
language (English / Hindi), voice (named Indian names, recommended one first), "Call me" (sir / madam / his name), and one
greeting of his faith (Hindu, Muslim, Sikh, Christian, Jain). The **Phone check** card on the Soundbox screen shows five
green ticks when the phone is ready; any red line says how to fix it.

---

## 2. How it works

```
Customer places an order
        |
        v
 backend: notificationService.orderPlaced()
   - builds the spoken sentence (utils/orderSpeech.js, English and Hindi)
   - center.notify('order_new')  ->  in-app live message (socket) + push
        |
        +--> PUSH 1, t = 0 s : a normal notification on channel "new_orders_v2", sound "new_order"
        |         Android itself plays res/raw/new_order.wav and vibrates (the app is not involved)
        |
        +--> PUSH 2, t = 3.6 s : a SILENT data message (no notification inside), data.speakOnly = "1"
                  Android hands it to the app's own code -> background task SOUNDBOX_SPEAK_ORDER
                  -> expo-speech reads the order with the owner's voice / language / greeting
```

Both pushes go only to the owner's phones that have Soundbox **on** (`DeviceToken.loudAlerts`). Phones with it off get a
plain notification on the app's normal channel and no silent message.

While the app is running (foreground, or in the background with the screen off and Soundbox on), the live socket message
starts the in-app alert instead (`soundbox.js`): a looping audio track whose position reports are the clock for the rounds.

### Why it is built this way (each point cost hours)

1. **A push can only play a sound file packed inside the app**, so it cannot say today's order. Hence the clip plus a
   second message that lets the app speak.
2. **JavaScript timers stop while the screen is off** (React Native), including inside the background task. Nothing that
   must run with the screen off may use `setTimeout`. The in-app loop is clocked by the audio player's status events; the
   3.6 s wait for the clip is done **on the server**.
3. **One audio player only.** Two players fought for audio focus and the "Soundbox is on" foreground service died.
4. The silent keep-alive track plus `setActiveForLockScreen` makes Android keep the app alive with the screen off.

---

## 3. Where the code is

### Backend (`backend/`)
| File | What it does |
|---|---|
| `src/utils/orderSpeech.js` | `orderSpeech(order)` / `orderSpeechHi(order)`: the sentence the phone reads ("New order. 2 Butter Naan... Total 540 rupees. Cash on delivery."). Max 5 items, then "and N more items". |
| `src/services/notificationService.js` | `orderPlaced` puts `speech`, `speechHi`, `itemCount` in the push data. |
| `src/notifications/events.js` | `NEW_ORDER_CHANNEL = 'new_orders_v2'`; `order_new` and `order_unaccepted_reminder` use it with sound `new_order`. |
| `src/notifications/channels/push.js` | Splits phones into loud / quiet; sends the notification, then the silent data message after `SPEECH_DELAY_MS` (default 3600). |
| `src/services/adapters/push.js` | Firebase sending (modular `firebase-admin` API), supports `channelId`, `sound`, `dataOnly`; logs refusals. |
| `src/models/DeviceToken.js` | `loudAlerts` flag per phone. |
| `src/routes/notificationRouter.js` | `POST /api/notifications/devices` accepts `loudAlerts`. |
| `src/routes/shopRouter.js` | `view()` adds `speech`/`speechHi` to owner order JSON; `POST /api/shop/test-alert` (owner only, 8 s rate limit) sends the owner his own test alert. |
| `scripts/testOwnerPush.js` | Command-line version of a test alert (see section 5). |

### Mobile (`mobile/`)
| File | What it does |
|---|---|
| `index.js` | Imports `backgroundTask.js` **first**: the task must exist at module scope, because with the app closed Android starts only the JS. |
| `src/utils/owners/backgroundTask.js` | Defines `SOUNDBOX_SPEAK_ORDER`. **Registered only when `!__DEV__`** (see section 6, item 5). |
| `src/utils/owners/soundbox.js` | The engine: voices and their Indian names, greeting, the single audio player, round timing (`onClock`), `speakForPush` (background reading), `speakOnOpen` (tap), diagnostics log (`getSoundboxLog`, no screen uses it now). |
| `src/utils/owners/greetings.js` | Faith greetings (English + Hindi) and "Call me". |
| `src/utils/common/push.js` | Creates channel `new_orders_v2` (sound `new_order.wav`, max importance, vibration), tells the server `loudAlerts`, tap handling, `newOrderChannelInfo()` for the Phone check. |
| `src/store/owners/useSoundboxStore.js` | The settings (kept on the phone). Soundbox mode defaults to **on**. |
| `src/store/owners/useAlertStore.js` | `ringing` flag, drives the "Silence" button on Home. |
| `src/screens/owners/SoundboxScreen.jsx` | Settings screen with the Phone check. |
| `src/screens/owners/OwnerHomeScreen.jsx` | Shows Soundbox status, and a Silence button while an order rings. |
| `assets/sounds/` | `new_order.wav` (native, played by Android), `alert_60.wav` and `silence.wav` (played by the app). |
| `scripts/sounds/` | `make-voice.ps1` + `make-sounds.js` regenerate all three sounds. |
| `plugins/withKeepSounds.js`, `app.config.js` | Sound registered with `expo-notifications` (`sounds`), `expo-audio` background playback, resource shrinking off. |

Native dependencies added: `expo-speech`, `expo-audio`, `expo-keep-awake`, `expo-task-manager`. Adding or changing any of
these, or `new_order.wav`, needs a **new native build** (not an OTA update).

---

## 4. Building and installing

The phone used in development: adb id `13ce6650` (OPPO, ColorOS).

**Release build** (the only build where the screen-off reading works):
```bash
cd mobile
npx expo prebuild --clean          # only after changing plugins, native dependencies or app.config.js
cd android
APP_TENANT=savera MEDIA_CDN_URL=https://pub-cdf80baebda94e259103a9ca07fe27e1.r2.dev ./gradlew.bat assembleRelease -x lint
adb install -r app/build/outputs/apk/release/app-release.apk      # keeps the login and settings
```
or `npx expo run:android --variant release` (same values for `APP_TENANT` / `MEDIA_CDN_URL`).
`APP_TENANT` and `MEDIA_CDN_URL` are required: without them `app.config.js` cannot fetch the shop icon and the Gradle step
`createReleaseUpdatesResources` fails with "No app icon found".

**Development build** (`npx expo run:android`): everything works **except** reading the order automatically with the screen
off (clip, vibration, tap-to-read and the app-open loop all work). Use a release build to test that part.

**The backend is a plain `node src/server/server.js` process** behind an ngrok address that is baked into the app
(`mobile/.env`, `EXPO_PUBLIC_BASE_URL`). Restart it after any backend change. The server needs `FCM_SERVICE_ACCOUNT_B64`
(same Firebase project as `mobile/google-services.json`) and `PUSH_MOCK=false`.

---

## 5. Testing it (the app no longer has test buttons)

1. **Place a real order** from a customer phone, or
2. **Send yourself a real alert from the command line** (backend folder):
   ```bash
   node scripts/testOwnerPush.js savera            # all owner phones of the shop
   node scripts/testOwnerPush.js savera 6498       # only the owner whose number ends in 6498
   node scripts/testOwnerPush.js savera --dry      # list the phones, send nothing
   ```
   Lock the phone first. Expected: the clip and vibration at once, then the order read out a few seconds later.
3. **Phone check** on the Soundbox screen must show five green ticks on a client's phone.

Automated tests (backend, `node --test --test-concurrency=1 --test-force-exit tests/<file>`):
`orderSpeech.test.js`, `loudAlerts.test.js`, `pushSetup.test.js` (plus the existing notification tests).

### Looking at what the phone did (adb)
```bash
adb -s 13ce6650 logcat -c                                   # clear, run the test, then:
adb -s 13ce6650 logcat -d -v time > live.log
grep -E "RingtonePlayer.*new_order|Started headless task|Finished headless task|Synthesis request" live.log
```
A healthy screen-off alert shows, in order: `RingtonePlayer play uri=android.resource://com.savera.app/raw/new_order`,
`Started headless task`, then `GoogleTTSServiceImpl ... Synthesis request`, then `Finished headless task`.
To check a build contains the sound:
```bash
unzip -l app-release.apk | grep 156312                      # new_order.wav is 156312 bytes
"$LOCALAPPDATA/Android/Sdk/build-tools/<version>/aapt2.exe" dump resources app-release.apk | grep raw/new_order
```

---

## 6. Pitfalls we hit (do not repeat)

1. **The Firebase library changed.** `firebase-admin` 14 has only the modular API (`firebase-admin/app`,
   `firebase-admin/messaging`). The old `admin.apps` / `admin.credential` threw "Push setup failed" and **no push was ever
   sent**. Fixed in `adapters/push.js`; `pushSetup.test.js` guards it.
2. **A notification channel's sound and vibration are frozen when the channel is first created on a phone.** A changed sound
   needs a **new channel id** (`new_orders` -> `new_orders_v2`); keep the id in sync in `events.js` and `push.js`.
3. **Android reports a channel's sound only as `custom`, `default` or `null`**, never the file name. `default` means the app
   could not find its sound file and Android fell back to the phone's normal ping.
4. **The release resource shrinker deleted `res/raw/new_order.wav`** (the app only looks it up by name). `app.config.js` now
   has `enableShrinkResourcesInReleaseBuilds: false`. A `keep.xml` rule alone did not work reliably.
5. **The background task must not be registered in a development build.** It starts a headless React context before any
   screen exists, and the Expo dev launcher then crashes on open with "App react context shouldn't be created before".
6. **JavaScript timers stop with the screen off** (section 2, point 2). The first version waited for the clip with
   `setTimeout` on the phone, so the order was only read when the owner woke the phone.
7. **Two audio players** fight for audio focus; use the single player in `soundbox.js`. The voice (TTS) pauses the player, so
   `speaking` blocks the auto-resume while it talks.
8. **A rebuild installed over an old build keeps old notification channels.** Check with the Phone check before assuming a fix failed.
9. Check the phone with adb before guessing. Most wrong turns came from guessing.

---

## 7. Limits and ideas

- The screen-off reading depends on the phone allowing a background task for a few seconds. ColorOS allowed it with the app's
  battery setting on Unrestricted; other brands (Xiaomi, Vivo, Realme) may block it. The clip and tap-to-read still work.
- The clip is fixed (English "New order received", Heera voice) and has no greeting; only the spoken order carries the greeting.
- The voice starts about 4 to 10 s after the clip, depending on how fast the phone's speech engine wakes.
- Android only. iOS has no loud-alert equivalent without Apple's Critical Alerts permission.
- `POST /api/shop/test-alert` and `getSoundboxLog` (the in-memory event log) remain for diagnostics, but nothing in the app shows them.
