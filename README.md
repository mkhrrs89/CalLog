# FoodLog

FoodLog is a mobile-first personal calorie logger built for fast repeat logging and a reusable local food database. It is a static web app designed to work well as an iPhone home-screen shortcut and can be hosted free with GitHub Pages.

## Included in Version 1

- Today dashboard with date navigation, daily total, visual accumulation bar, pinned foods, chronological/grouped views, and day-complete status
- Fast Add Food bottom sheet with live search, manual calorie entry, optional meal tag, notes, confidence, source, and saved-food support
- Reusable food database with pins, aliases, source, folder, tags, multiple portions, multipliers, duplicate warnings, bulk management, and hidden revision history
- Editable daily entries with immutable snapshots of saved-food values
- Copy individual entries, meal-tag groups, or a previous day
- Custom meal tags with custom colors
- Visual Stats dashboard with calorie trends, popular foods, meal-tag totals, confidence breakdown, database growth, and source totals
- Full JSON backup and restore, plus CSV exports for entries and foods
- Local IndexedDB storage, automatic system light/dark mode, teal accents, and offline support after the first successful load

## Deploy with GitHub Pages

1. Create a new GitHub repository named `FoodLog`.
2. Upload every file in this folder to the repository root.
3. Open the repository's **Settings**, then **Pages**.
4. Under **Build and deployment**, choose **Deploy from a branch**.
5. Select the `main` branch and the root `/` folder, then save.
6. Open the Pages site after GitHub finishes publishing it.
7. On the iPhone, use the browser's share/menu options and choose **Add to Home Screen**.

The included black-square icon with a white **F** is used for the home-screen shortcut where supported.

## Data safety

FoodLog stores data in the browser's local IndexedDB database. The data is not automatically uploaded to GitHub or another cloud service.

Use **Settings → Export Full Backup** regularly, especially before:

- clearing browser or website data
- replacing or resetting the phone
- switching browsers or devices
- importing another backup

The JSON backup contains the full restorable database. CSV exports are intended for reading or analysis and are not a complete app restore format.

## Local testing

From this folder, run:

```bash
python -m http.server 8000
```

Then open `http://localhost:8000` in a browser.

## Project isolation

FoodLog is standalone. It does not modify or depend on the existing Workout-Log or CalCount projects.
