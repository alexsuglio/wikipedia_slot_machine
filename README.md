# Wikipedia Article Slot Machine

A playful JavaScript app where you pull a lever, watch a slot-machine style spin animation, and land on a random Wikipedia article.

https://alexsuglio.github.io/wikipedia_slot_machine/

## New Features

- Slot-machine sound effects built with Web Audio API (no external sound files)
- Sound toggle with persisted preference (`Sound: On/Off`)
- Theme picker for category-biased randomization:
	- Anything
	- History
	- Science
	- Sports
	- Technology
	- Arts

Theme mode uses a two-step strategy:

- Try random article pulls and keep only matches based on Wikipedia categories
- If matching takes too long, fallback to random page selection from a related category list

## Why not random page IDs?

Wikipedia page IDs are not a clean contiguous range of article-only IDs. IDs can be missing, deleted, redirected, or point to non-article namespaces.

This project uses Wikipedia's random API endpoint instead:

- `action=query&list=random`
- `rnnamespace=0` (main/article namespace only)

That gives a true random article title and page ID without guessing ranges.

## Tech

- Vanilla JavaScript
- HTML/CSS
- `serve` as a lightweight static server

## Run It

### 1) Install dependencies

```bash
npm install
```

### 2) Start the app

```bash
npm run dev
```

Then open `http://localhost:5173`.

## Scripts

- `npm run dev` starts local server on port `5173`
- `npm start` same as dev

## Notes

- No API keys required
- If summary text fails to load, the app still returns a random article link
- Works on desktop and mobile layouts
