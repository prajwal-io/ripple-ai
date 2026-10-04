# Ripple AI

Ripple loads a real Miro board, displays its items and connectors, asks Qwen to stress-test the plan through ModelScope's OpenAI-compatible API, and can add impact markers, blind spots, and a recovery-plan frame back to Miro. The UI does not include a sample board or fabricated simulation results.

## Run locally

```powershell
npm ci
Copy-Item .env.example .env
npm run dev
```

Open http://localhost:4173. The app displays only data returned from the selected Miro board. Analysis actions stay disabled until a Qwen key and API base URL are configured.

Create the ignored `.env` file from `.env.example` and fill in your credentials. Keep the API key and Miro credentials there; do not copy secrets into frontend code or commit them.

## Enable Qwen

Configure `QWEN_API_KEY`, `QWEN_BASE_URL`, and `QWEN_MODEL` in `.env`. The current ModelScope setup uses `https://api-inference.modelscope.ai/v1` and `Qwen-Ambassador/Qwen3.8-Max`. Ripple sends board context to the Node server, which calls the OpenAI-compatible chat completions endpoint. The API key stays server-side.

## Connect Miro

1. Create a Miro app in a Miro Developer team.
2. Add the `boards:read` and `boards:write` scopes.
3. Set the app's redirect URL to `http://localhost:4173/api/miro/callback`.
4. Add the app's client ID and client secret to `.env` as `MIRO_CLIENT_ID` and `MIRO_CLIENT_SECRET`.
5. Restart the server, choose **Connect Miro**, authorize Ripple, then choose **Load board**.

For one local user, an existing OAuth access token can be set as `MIRO_ACCESS_TOKEN`. Keep it in the ignored `.env`; the server never sends it to the browser. The token needs board read/write scopes and may expire based on the Miro app's settings.

Access tokens are held in the server's in-memory session. Restarting the server clears OAuth sessions. Report writes reuse frames recorded in the local, ignored `.ripple-reports.json` registry. Only unchanged notes previously created by this installation are replaced; manually edited notes and other board items are preserved. Keep that file between restarts to reuse existing reports. This app uses the Miro REST API; a Miro MCP connector is not available in this workspace.

## Production build

```powershell
npm run build
npm run start
```

Set `APP_ORIGIN`, `MIRO_REDIRECT_URI`, Qwen settings, and Miro app credentials in the hosting environment. Use HTTPS and a durable session/token store before deploying for multiple users.

## Live integration check

The test mounts the real React UI in a DOM environment and calls the running backend, Miro, and Qwen without mocked API responses. It checks load/reload, simulation, connectors, result rendering, report refresh, and API errors. This is a functional integration test; it does not check browser layout.

```powershell
$env:RIPPLE_TEST_BOARD_ID="your-authorized-board-id"
# Optional: authorize real report writes and test every analysis mode.
$env:RIPPLE_TEST_WRITE="1"
$env:RIPPLE_TEST_ALL_MODES="1"
npm run test:integration
```

Run the app in another terminal first. The full check makes four real AI requests and, when writes are enabled, updates impact, recovery, and blind-spot reports on the selected board.

Set `RIPPLE_TEST_SMOKE=1` to check board loading, reload, help, connector rendering, and API errors without AI requests or board writes.
