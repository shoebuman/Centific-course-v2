# Centific Medical Transcription Training Portal

Ready-to-host static files are in this folder:

- `index.html`
- `styles.css`
- `app.js`
- `medical_transcription_v4_2.html`
- `google-apps-script.gs` (copy into Google Apps Script; do not upload this one as part of the public course unless you want to keep the setup helper in the repo)

Upload all four files to the same GitHub repository folder. GitHub Pages can host this as a static site.

## What is wired

- Learners enter a username before the course starts.
- The selected locale opens the matching course language.
- Module completion and the active course screen are saved in browser local storage, so refreshes do not reset completed modules.
- Final assessment selections are also saved while the learner is on the assessment.
- Missed final assessment questions are highlighted in orange before submission.
- Final score submissions include `timestamp`, `username`, `selectedLocale`, `courseLanguage`, `score`, `total`, `percentage`, `passingScore`, and `status`.

## Google Sheets

The portal currently posts to this Apps Script endpoint in `app.js`:

```js
const SCORE_ENDPOINT = "https://script.google.com/macros/s/AKfycbwi7VHztiBbAtie1nt5KQiJ1kfwaGnCyEponf41GZhE_9lr--swE6ZLlcd1oiGL5qLnyw/exec";
```

Use `google-apps-script.gs` as the Apps Script Web App code if your sheet does not already have a compatible script. Because the browser uses `mode: "no-cors"`, a successful send cannot read the Apps Script response, but the request is still sent.

