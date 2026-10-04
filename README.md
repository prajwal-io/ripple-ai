# Ripple AI

Ripple loads a real Miro board, displays its items and connectors, asks Qwen to stress-test the plan through ModelScope's OpenAI-compatible API, and can add impact markers, blind spots, and a recovery-plan frame back to Miro. The UI does not include a sample board or fabricated simulation results.

## Run locally

```powershell
npm install
npm run dev
```

Open http://localhost:4173. The app displays only data returned from the selected Miro board. Analysis actions stay disabled until a Qwen key and API base URL are configured.

An ignored `.env` file is prepared locally. Keep the API key and Miro credentials there; do not copy secrets into frontend code or commit them.

## Enable Qwen

Configure `QWEN_API_KEY`, `QWEN_BASE_URL`, and `QWEN_MODEL` in `.env`. The current ModelScope setup uses `https://api-inference.modelscope.ai/v1` and `Qwen-Ambassador/Qwen3.8-Max`. Ripple sends board context to the Node server, which calls the OpenAI-compatible chat completions endpoint. The API key stays server-side.

## Connect Miro

1. Create a Miro app in a Miro Developer team.
2. Add the `boards:read` and `boards:write` scopes.
3. Set the app's redirect URL to `http://localhost:4173/api/miro/callback`.
4. Add the app's client ID and client secret to `.env` as `MIRO_CLIENT_ID` and `MIRO_CLIENT_SECRET`.
5. Restart the server, choose **Connect Miro**, authorize Ripple, then choose **Load board**.

For one local user, an existing OAuth access token can be set as `MIRO_ACCESS_TOKEN`. Keep it in the ignored `.env`; the server never sends it to the browser. The token needs board read/write scopes and may expire based on the Miro app's settings.

Access tokens are held in the server's in-memory session. Restarting the server clears OAuth sessions. Board writes add new frames and notes; they do not modify or delete source items. This app uses the Miro REST API; a Miro MCP connector is not available in this workspace.

## Production build

```powershell
npm run build
npm run start
```

Set `APP_ORIGIN`, `MIRO_REDIRECT_URI`, Qwen settings, and Miro app credentials in the hosting environment. Use HTTPS and a durable session/token store before deploying for multiple users.

