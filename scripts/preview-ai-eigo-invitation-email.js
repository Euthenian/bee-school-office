import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderAiEigoInvitationHtml } from "../lib/communications-worker.js";

// Local visual sample only. This token is invalid and must never be sent.
const previewUrl = "https://ai-eigo.com/invite/PREVIEW_ONLY_INVALID_TOKEN";
const body = `Bee Schoolの生徒・保護者の皆さまへ

Bee Schoolに通う生徒の皆さまは、特典としてAI-EIGOの「Voice Check（発音チェック）」機能を無料でご利用いただけます。

以下のボタンからAI-EIGOにアクセスし、ログインまたは新規登録をお願いいたします。

[CTA: 利用を開始する]

ボタンが開かない場合は、以下のURLをコピーしてブラウザに貼り付けてください。

${previewUrl}

このご案内リンクはお送りした方専用です。他の方への転送はお控えください。

このリンクは送信後14日間有効です。

Bee School`;

const previewPath = fileURLToPath(new URL("../docs/previews/ai-eigo-invitation.html", import.meta.url));
mkdirSync(fileURLToPath(new URL("../docs/previews/", import.meta.url)), { recursive: true });
writeFileSync(previewPath, `<!-- Local preview with an invalid example URL. Do not send. -->\n${renderAiEigoInvitationHtml(body)}\n`, "utf8");
