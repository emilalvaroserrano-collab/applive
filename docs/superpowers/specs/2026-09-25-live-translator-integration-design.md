# Live translator integration design

## Goal

Add the working live translator behavior from `working-live-translator` to the active Orbit meeting experience. The active meeting route is served by the vendored Jitsi application, so the integration belongs in the Jitsi extension rather than the shadowed React meeting components.

## User behavior

- The Translator toolbar button opens the existing left sidebar.
- The user selects a target language and presses **Start Translation**.
- Translation captures incoming participant audio and shared-screen audio exposed by Jitsi.
- The current user's microphone is never included in the translation input stream.
- The model session remains connected until **Stop Translation**, panel close, or track failure.
- The sidebar shows connection status, source transcript, translated transcript, and a retry action.

## Model and transport

- Use `gemini-3.5-live-translate-preview`, matching the reference app.
- Read `GEMINI_API_KEY` from the Vercel server environment. Never commit or send the raw key to the browser.
- Mint a short-lived, one-use server token when the user starts a session.
- Connect the browser directly to the Gemini bidirectional WebSocket using the ephemeral token.
- Send 16 kHz mono PCM frames in `realtimeInput` messages.
- Receive 24 kHz PCM audio and input/output transcriptions.
- Queue translated audio in one output context and reset the queue on interruption.

## Audio source selection

The extension will inspect Jitsi base tracks and create a single incoming `MediaStream`:

- Include live, unmuted remote audio tracks.
- Include live screen-share audio tracks when Jitsi identifies them as screen-share or otherwise non-microphone audio.
- Exclude local microphone tracks.
- Exclude video tracks and tracks without an attachable Jitsi audio source.
- Refresh the source signature when participants or screen shares change. Restart the model session only when the eligible source set changes.

The implementation will not call `getUserMedia` for translation and will not create a separate local microphone capture.

## Client lifecycle

1. The sidebar loads language metadata and waits for eligible Jitsi audio.
2. Start is disabled until eligible audio is available.
3. Start requests a token, creates the WebSocket, waits for setup completion, then starts the AudioWorklet.
4. Audio frames are sent only after setup completion.
5. Stop or sidebar close closes the socket, worklet, audio contexts, output sources, and hidden track elements.
6. Retry repeats the same user-initiated start flow.
7. Track changes stop the old session and create a fresh session only if translation is still active.

## Error handling

- Missing Vercel configuration returns a generic configuration error.
- Invalid target languages return a validation error.
- Missing audio shows a waiting state without starting a model session.
- WebSocket, permission, and audio-context failures stop cleanly and expose a retry action.
- Server errors do not expose provider details or credentials.

## Files in scope

- `vendor/jitsi/orbit-extension.js`: active translator client, source selection, manual controls, transcripts, and playback.
- `src/routes/api.translate-token.ts`: server-only token minting and language validation.
- `src/lib/translation-languages.ts`: supported language catalog, if a small correction is needed.
- `scripts/jitsi-brand.mjs`: extension asset loading, if versioned delivery changes are required.
- `vendor/jitsi/index.html`: extension cache version, if the extension changes require it.

React files under `src/components/orbit` remain unchanged because the Jitsi middleware currently owns `/meet/*`.

## Verification

- Run `npm run typecheck` and `npm run build`.
- Check the Translator toolbar and left sidebar at desktop and mobile widths.
- Confirm language selection, manual Start, Stop, retry, panel close, and track-change cleanup.
- Confirm no local microphone permission or local microphone stream is created by translation.
- Confirm the token endpoint returns a generic response when the Vercel environment variable is absent.
- Confirm no token or API key appears in the Git diff, generated output, or browser source.
