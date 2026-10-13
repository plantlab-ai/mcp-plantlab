# PlantLab MCP

This project connects a local AI client to the PlantLab API through MCP, the standard protocol for AI tools.
It provides three tools through Streamable HTTP at a loopback `/mcp` endpoint.
This first milestone uses one PlantLab account per server process.

The prototype passes local mock tests. No live diagnosis or ChatGPT connection ran for this release.
OAuth, account linking, hosted deployment, and directory submission remain unfinished.
Do not expose this credential mode as a shared ChatGPT service.

## Install and demonstrate

Use Node.js 22 or 24 and npm.

```sh
git clone https://github.com/plantlab-ai/mcp-plantlab.git
cd mcp-plantlab
npm ci
npm run typecheck
npm run lint
npm test
npm run build
npm run demo
```

The demonstration starts a local mock API and the MCP server on temporary loopback ports.
An official SDK client initializes MCP, lists all three tools, and calls each tool.
The mock generates its credential and a synthetic PNG in memory.
The demonstration sends exactly one diagnosis request to the mock API and closes its own servers.
It prints only public mock results.

The demonstration replaces photo retrieval with synthetic bytes.
It exercises the real HTTP API client, multipart upload, MCP transport, response mapping, and tool schemas.
Separate file tests exercise destination rules, byte limits, image decoding, expired references, and pinned-address selection.
Tests do not establish live API quota, history, consent, retention, or diagnosis accuracy.

## Configure local use

Set `PLANTLAB_API_KEY` through your process environment or secret manager.
Never put the key in chat, a tool argument, a configuration example, a log, or Git.
The server fails startup if the key is absent.
No key is needed to run the mock demonstration.

Set `PLANTLAB_FILE_ORIGINS` to a comma-separated list of exact HTTPS origins for authorized file references.
The list is empty by default, so photo downloads remain disabled until you configure it.
Choose only origins that your client uses for selected photos.
ChatGPT file hosts and expiry bounds still need an authorized connection test.
Do not assume that an example host is a valid ChatGPT file origin.

`PLANTLAB_API_URL` defaults to `https://api.plantlab.ai`.
A local mock URL can use HTTP on `localhost`, `127.0.0.1`, or `::1`.
Other API destinations require HTTPS.
`PORT` defaults to `3000`.

After you set the environment, start the built server:

```sh
npm start
```

Connect a local Streamable HTTP client to `http://127.0.0.1:3000/mcp`.
The server binds only `127.0.0.1` and rejects browser Origin headers and unexpected Host headers.
Any local process that can reach this port can use the configured account.
Use a separate process for each account. This mode has no user authentication at the MCP endpoint.
It does not advertise OAuth, account linking, or shared-service readiness.

## Tools

`get_supported_diagnoses` accepts an empty object.
It returns supported species, diagnosis scope, accepted formats, and upload limits.
The species and diagnosis list comes from the public API contract snapshot dated October 13, 2026.
The current API `/info` response supplies format and body limits. It supplies no species or diagnosis list.
The adapter reports this source distinction and does not claim live species discovery.
Cannabis capability uses public diagnosis categories because the public contract does not enumerate all named cannabis findings.
Tomato capability lists the nine served named causes from the public contract.

`get_usage` accepts an empty object.
It returns daily and monthly counts, limits, remaining allowance, and reset times for the configured account.
PlantLab remains the quota authority. The adapter adds no allowance or billing flow.

`diagnose_plant` accepts one required `image` object.
It declares `_meta["openai/fileParams"]: ["image"]`.
The file object requires `download_url` and `file_id`.
It declares optional `mime_type` and `file_name` fields.
Both optional fields can be absent. The server derives the MIME type and filename from validated bytes.

```json
{
  "image": {
    "download_url": "https://files.example.test/selected-photo.png",
    "file_id": "selected-photo"
  }
}
```

This reference describes the schema only. The example host does not serve a photo.
A diagnosis requires an explicit user request to analyze the selected photo.
The tool sends one multipart `image` to `/diagnose` and returns the allowed public fields.
It preserves species, scope, routing reason, per-plant regions, suspected findings, and uncertainty.
Absent health fields stay absent. An unhealthy result without a named cause stays unhealthy.
The adapter does not generate care advice or stronger findings.

Every tool declares an input schema and a success output schema.
Successful results appear in `structuredContent` and JSON text.
Failures use MCP `isError: true` with JSON text containing `success: false` and an error object.
The error object contains `code`, `message`, and `completion_unknown`.
Raw upstream error text, internal identifiers, response timings, internal versions, and verification payloads stay out of results.

The two read tools declare `readOnlyHint: true` and `idempotentHint: true`.
Diagnosis declares both hints as `false` because it consumes quota and can write history.
All tools declare `destructiveHint: false` and `openWorldHint: false`.
Diagnosis accesses only the configured PlantLab account and explicitly allowed file origins.
Annotations do not grant permission or establish account consent.

## File and request limits

The adapter accepts complete JPEG and PNG images only.
It caps each photo at 9 MiB, each dimension at 8,192 pixels, and decoded images at 50 million pixels.
The 9 MiB cap leaves room below the API default 10 MiB multipart body limit.
A lower upstream body limit can reject a photo. The capability tool reports a lower limit when `/info` supplies one.
The adapter rejects multiple-page images, corrupt images, HEIC, and compressed HTTP transfers.

File retrieval requires an exact configured HTTPS origin and no URL credentials.
The server rejects private, loopback, link-local, metadata, multicast, and special-use DNS addresses.
It rejects a hostname if any resolved address fails this rule.
The connection uses one approved address directly, with the original hostname for TLS verification.
This prevents a second DNS lookup from changing the destination.
All redirects fail. The server does not follow them to another host or private address.
Expired or unavailable references return an error that asks the user to select the photo again.

Downloads have a 15-second total deadline, including DNS and body reads.
Image decoding has a five-second processing limit after metadata inspection.
API calls have a 30-second deadline and a 1 MiB response limit.
MCP request bodies have a 64 KiB limit.
One account instance permits four active photos.
Photos remain in bounded memory. The adapter writes no photo files and logs no signed URLs or original filenames.
PlantLab credentials go only to the API header, never to file hosts.

Concurrent calls with the same `file_id` share an active operation within one account instance.
Different account instances do not share operations or results.
The adapter removes the entry after completion and keeps no persistent result cache.
A deliberate later call can consume another allowance.

The adapter never retries diagnosis automatically.
A timeout, malformed response, lost connection, redirect, oversized response, or upstream server failure marks completion as unknown.
An unknown completion can already consume quota.
Quota errors contain no subscription promotion or checkout link.

## Remaining ChatGPT work

A shared service needs OAuth authorization and authenticated linking to existing PlantLab accounts.
It must enforce token issuer, audience, signature, expiry, scopes, and revocation on every protected call.
It needs protected-resource discovery, PKCE S256, supported client registration, and scopes `diagnosis:run` and `usage:read`.
Each request must resolve the linked account without a shared key or a model-supplied account identifier.

A pilot needs an explicit consent screen, photo recipients, retention periods, account history behavior, and a proven channel capture policy.
Permission to diagnose does not establish permission to capture training photos.
This adapter does not change account preferences or promise a no-capture channel.
Do not use the local credential mode for a shared ChatGPT pilot.

Further work includes actual ChatGPT file-host observations, measured tool deadlines, temporary-service integration tests, and account isolation under OAuth.
Hosted deployment, real diagnosis calls, capture changes, crop eligibility, publisher verification, sample-account testing, and directory submission remain open.
These tasks do not block the local mock prototype.

## Sources and SDK choice

The adapter uses the official SDK v2 server and Node transport packages with exact versions in the lockfile.
The [official MCP SDK repository](https://github.com/modelcontextprotocol/typescript-sdk) identifies v2 as the stable release line.
The [HTTP guide](https://ts.sdk.modelcontextprotocol.io/v2/serving/http.html) describes the stateless handler and Node adapter.
The [OpenAI file reference](https://developers.openai.com/plugins/reference#file-apis) defines the file object and metadata.
The [OpenAI authentication guide](https://developers.openai.com/plugins/build/auth) describes the remaining OAuth requirements.
These sources were read on October 13, 2026.

The public serving contract is available in the [PlantLab API reference](https://plantlab.ai/agent-reference.md) and [OpenAPI contract](https://plantlab.ai/openapi.json).
The prototype tests use synthetic fixtures that match its public fields.
