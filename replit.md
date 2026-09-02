# Replit setup

## Run the app

This project is a static HTML/JavaScript application with no build step. The
`Start application` workflow serves the repository root with:

```sh
python3 -m http.server 5000 --bind 0.0.0.0
```

The app is available through the Replit preview on port 5000. It requires a
browser with WebGPU support to load and run the local models. The first model
load downloads and caches the selected model weights in the browser.

## Development checks

Install the declared Node.js development dependencies with:

```sh
npm install
```

Run the project checks with:

```sh
npm test
npm run lint
```

At setup time, the imported test suite had 267 passing tests and 2 existing
failures in `tests/models.test.js` and `tests/sessions.test.js`, both related to
model-default and legacy-session expectations. The broad lint command also
scans bundled files under `.local/` and currently reports pre-existing
environment-global errors there.