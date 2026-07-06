import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MODEL_KEYS = [
  { key: "DEFAULT_MODEL", label: "Default" },
  { key: "MODEL_WEAK", label: "Weak" },
  { key: "MODEL_MEDIUM", label: "Medium" },
  { key: "MODEL_STRONG", label: "Strong" },
];

async function readDotEnvModels() {
  const envPath = path.join(/*turbopackIgnore: true*/ process.cwd(), ".env.local");
  if (!existsSync(envPath)) {
    return {};
  }
  const env = {};
  const content = await readFile(envPath, "utf8").catch(() => "");
  for (const line of content.split(/\r?\n/)) {
    const match = /^([A-Z0-9_]+)=(.*)$/i.exec(line.trim());
    if (match) {
      env[match[1]] = match[2].replace(/^["']|["']$/g, "");
    }
  }
  return env;
}

export async function GET() {
  const fileEnv = await readDotEnvModels();
  const seen = new Set();
  const models = [];
  for (const item of MODEL_KEYS) {
    const id = String(process.env[item.key] || fileEnv[item.key] || "").trim();
    if (!id || seen.has(id)) {
      continue;
    }
    seen.add(id);
    models.push({
      id,
      label: `${item.label}: ${id}`,
      envKey: item.key,
    });
  }
  return NextResponse.json({ models });
}
