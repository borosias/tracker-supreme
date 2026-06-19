# Tracker Supreme

Recruiting pipeline tracker for hiring processes, recruiter contacts, interview stages, offers, source import, Google Sheet storage, and Google Calendar follow-ups.

## Run Locally

```bash
npm install
npm run dev
```

Open the Vite URL, usually `http://127.0.0.1:5173`.

## Production Check

```bash
npm run lint
npm run build
```

## PWA Check

The service worker is registered only in production builds, so test installability through Vite preview:

```bash
npm run build
npm run preview
```

Open the preview URL and use the browser install button. The app shell is cached for offline launch, while Google Sheet and Apps Script data sync still requires network.

## GitHub Pages Deploy

This project is configured for repository Pages at:

```txt
https://<github-user>.github.io/tracker-supreme/
```

The important setting is `base: '/tracker-supreme/'` in `vite.config.js`. The PWA manifest and service worker are also path-safe for this repository URL.

To deploy:

1. Push the repo to GitHub.
2. Open `Settings -> Pages`.
3. Set `Build and deployment -> Source` to `GitHub Actions`.
4. Push to `main` or run `Deploy to GitHub Pages` from the `Actions` tab.

If you rename the repository, update `base` in `vite.config.js` to match the new repository slug.

## Backend Setup

The Google Apps Script backend is in `apps-script/Code.gs`.

Setup details are in `docs/setup.md`. In short:

1. Create a Google Sheet.
2. Open `Extensions -> Apps Script`.
3. Paste `apps-script/Code.gs`.
4. Add Script Properties:
   - `APIFY_TOKEN`
   - `SHARED_SECRET` optional, recommended
   - `SPREADSHEET_ID` optional for standalone script
5. Deploy as a Web App.
6. Paste the Web App URL into the tracker `API` tab.

## Data Model

The main entity is a hiring process. It keeps current fields for fast UI and stores every meaningful change as an event.

- `hiringStage`: application, recruiter talk, HR screen, tech interview, client/final interview, pre-offer final, offer.
- `workState`: active, waiting, action required, paused, lost, offer received, offer accepted, offer declined.
- `statusReason`: client rejected, failed interview, position closed, internal hire, recruiter ghosted, project postponed, candidate withdrew, no budget, other.
