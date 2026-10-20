# Radio

A small internet radio app for iPhone. It is a web app (PWA): host it on GitHub Pages,
open it in Safari, and add it to your Home Screen. It then opens full screen like a normal app.

Stations come from the free [Radio Browser](https://www.radio-browser.info) directory
(about 50,000 stations worldwide).

## Features

- Top stations, search by name, browse by country
- Favorites (saved on the phone)
- Keeps playing with the screen locked; lock-screen and Control Center play/pause
- Remembers the last station, tab and country

## Install on iPhone

1. In this repo on GitHub: **Settings → Pages → Build and deployment**, set
   **Source** to *Deploy from a branch*, branch `main`, folder `/ (root)`, and save.
2. After a minute the app is live at `https://<your-username>.github.io/radio/`.
3. Open that link in **Safari** on the iPhone.
4. Tap **Share** → **Add to Home Screen** → **Add**.
5. Open **Radio** from the Home Screen.

## Notes

- Only `https://` streams are listed, because iOS blocks insecure audio inside a secure page.
- Some stations go offline from time to time; if one does not play, try another.
