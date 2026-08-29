import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { randomBytes } from "node:crypto";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_TOKEN_INFO_URL = "https://oauth2.googleapis.com/tokeninfo";
const DEFAULT_ENV_FILE = ".env.gmail.local";
const DEFAULT_PROJECT_REF = "fvtutcyootnvekegptcb";
const DEFAULT_MAILBOX = "bee.school.fukuoka@gmail.com";
const DEFAULT_REDIRECT_URI = "http://127.0.0.1:8976/oauth2callback";
const REQUIRED_SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send"
];

async function main() {
  const envFile = path.resolve(process.cwd(), process.env.GMAIL_REAUTHORIZE_ENV_FILE || DEFAULT_ENV_FILE);
  const envFileValues = loadEnvFile(envFile);
  const getConfig = (name) => process.env[name] || envFileValues[name] || "";
  const clientId = getConfig("GMAIL_CLIENT_ID");
  const clientSecret = getConfig("GMAIL_CLIENT_SECRET");
  const mailbox = getConfig("GMAIL_SOURCE_MAILBOX") || DEFAULT_MAILBOX;
  const redirectUri = getConfig("GMAIL_REAUTHORIZE_REDIRECT_URI") || getConfig("GMAIL_REDIRECT_URI") || DEFAULT_REDIRECT_URI;
  const projectRef = getConfig("SUPABASE_PROJECT_REF") || readLinkedProjectRef() || DEFAULT_PROJECT_REF;

  if (!clientId || !clientSecret) {
    throw new Error(`GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET must be present in ${path.basename(envFile)} or process env.`);
  }

  const redirectUrl = new URL(redirectUri);
  if (!["127.0.0.1", "localhost"].includes(redirectUrl.hostname)) {
    throw new Error("GMAIL_REAUTHORIZE_REDIRECT_URI must be a local loopback URL for this helper.");
  }

  const port = Number(redirectUrl.port || (redirectUrl.protocol === "https:" ? 443 : 80));
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error("GMAIL_REAUTHORIZE_REDIRECT_URI must include a valid port.");
  }

  const state = randomBytes(24).toString("hex");
  const authUrl = buildAuthorizationUrl({ clientId, mailbox, redirectUri, state });

  console.log("Bee School Gmail reauthorization");
  console.log(`Sender: ${mailbox}`);
  console.log(`Redirect URI: ${redirectUri}`);
  console.log("Scopes: gmail.readonly + gmail.send");
  console.log("");
  console.log("Open this URL if your browser does not open automatically:");
  console.log(authUrl.toString());
  console.log("");

  const code = await waitForAuthorizationCode({ authPath: redirectUrl.pathname, authUrl, port, state });
  const tokenResponse = await exchangeAuthorizationCode({ clientId, clientSecret, code, redirectUri });

  if (!tokenResponse.refresh_token) {
    throw new Error("Google did not return a refresh token. Re-run the helper and complete the consent prompt.");
  }

  const scopeText = await resolveGrantedScopes(tokenResponse);
  const missingScopes = REQUIRED_SCOPES.filter((scope) => !scopeText.split(/\s+/).includes(scope));
  if (missingScopes.length) {
    throw new Error(`Authorization completed, but required Gmail scopes are missing: ${missingScopes.join(", ")}`);
  }

  writeFileSync(envFile, upsertEnvValue(readExistingEnvText(envFile), "GMAIL_REFRESH_TOKEN", tokenResponse.refresh_token));
  await updateSupabaseRefreshTokenSecret({ projectRef, refreshToken: tokenResponse.refresh_token });

  console.log("");
  console.log("Done. The existing Supabase secret GMAIL_REFRESH_TOKEN was replaced.");
  console.log("No email was sent.");
}

function buildAuthorizationUrl({ clientId, mailbox, redirectUri, state }) {
  const authUrl = new URL(GOOGLE_AUTH_URL);
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", REQUIRED_SCOPES.join(" "));
  authUrl.searchParams.set("access_type", "offline");
  authUrl.searchParams.set("prompt", "consent");
  authUrl.searchParams.set("include_granted_scopes", "true");
  authUrl.searchParams.set("login_hint", mailbox);
  authUrl.searchParams.set("state", state);
  return authUrl;
}

function waitForAuthorizationCode({ authPath, authUrl, port, state }) {
  return new Promise((resolve, reject) => {
    const server = createServer((request, response) => {
      const requestUrl = new URL(request.url || "/", `http://127.0.0.1:${port}`);

      if (requestUrl.pathname !== authPath) {
        response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        response.end("Not found.");
        return;
      }

      if (requestUrl.searchParams.get("state") !== state) {
        response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
        response.end("Invalid OAuth state.");
        reject(new Error("OAuth state did not match."));
        server.close();
        return;
      }

      const error = requestUrl.searchParams.get("error");
      if (error) {
        response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
        response.end("Authorization failed. You can close this tab.");
        reject(new Error(`Google authorization failed: ${error}`));
        server.close();
        return;
      }

      const code = requestUrl.searchParams.get("code");
      if (!code) {
        response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
        response.end("Missing authorization code.");
        reject(new Error("Authorization callback did not include a code."));
        server.close();
        return;
      }

      response.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Bee School Gmail authorization received. You can close this tab.");
      resolve(code);
      server.close();
    });

    server.on("error", reject);
    server.listen(port, "127.0.0.1", () => openBrowser(authUrl.toString()));
  });
}

async function exchangeAuthorizationCode({ clientId, clientSecret, code, redirectUri }) {
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      grant_type: "authorization_code",
      redirect_uri: redirectUri
    })
  });

  if (!response.ok) {
    throw new Error(`Google token exchange failed with HTTP ${response.status}.`);
  }

  return response.json();
}

async function resolveGrantedScopes(tokenResponse) {
  if (tokenResponse.scope) return tokenResponse.scope;
  if (!tokenResponse.access_token) return "";

  const tokenInfoUrl = new URL(GOOGLE_TOKEN_INFO_URL);
  tokenInfoUrl.searchParams.set("access_token", tokenResponse.access_token);
  const response = await fetch(tokenInfoUrl);
  if (!response.ok) return "";

  const json = await response.json();
  return json.scope || "";
}

async function updateSupabaseRefreshTokenSecret({ projectRef, refreshToken }) {
  const tempFile = path.join(tmpdir(), `bee-school-gmail-${process.pid}-${Date.now()}.env`);
  writeFileSync(tempFile, `GMAIL_REFRESH_TOKEN=${escapeEnvValue(refreshToken)}\n`);

  try {
    const command = process.platform === "win32" ? "npx.cmd" : "npx";
    const result = spawnSync(
      command,
      ["supabase", "secrets", "set", "--project-ref", projectRef, "--env-file", tempFile, "--yes"],
      { encoding: "utf8", stdio: "pipe" }
    );

    if (result.status !== 0) {
      throw new Error("Supabase secret update failed. Re-run after confirming the Supabase CLI is logged in.");
    }
  } finally {
    try {
      unlinkSync(tempFile);
    } catch {
      // Best effort cleanup only; the temporary file contains a secret.
    }
  }
}

function openBrowser(url) {
  const command =
    process.platform === "win32"
      ? ["cmd", ["/c", "start", "", url]]
      : process.platform === "darwin"
        ? ["open", [url]]
        : ["xdg-open", [url]];

  spawnSync(command[0], command[1], { stdio: "ignore", detached: true });
}

function loadEnvFile(filePath) {
  if (!existsSync(filePath)) return {};

  const values = {};
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    values[match[1]] = unquoteEnvValue(match[2].trim());
  }
  return values;
}

function readExistingEnvText(filePath) {
  return existsSync(filePath) ? readFileSync(filePath, "utf8") : "";
}

function upsertEnvValue(text, name, value) {
  const lines = text ? text.split(/\r?\n/) : [];
  let updated = false;
  const nextLines = lines.map((line) => {
    if (!line.match(new RegExp(`^\\s*${name}=`))) return line;
    updated = true;
    return `${name}=${escapeEnvValue(value)}`;
  });

  if (!updated) nextLines.push(`${name}=${escapeEnvValue(value)}`);
  return nextLines.join("\n").replace(/\n*$/, "\n");
}

function escapeEnvValue(value) {
  return JSON.stringify(String(value));
}

function unquoteEnvValue(value) {
  const trimmed = String(value || "").trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function readLinkedProjectRef() {
  for (const candidate of [
    path.resolve(process.cwd(), "supabase", ".temp", "project-ref"),
    path.resolve(process.cwd(), ".temp", "project-ref")
  ]) {
    if (existsSync(candidate)) {
      return readFileSync(candidate, "utf8").trim();
    }
  }

  return "";
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
