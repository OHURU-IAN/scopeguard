import api, { route } from "@forge/api";
import { readJson } from "./http";

export interface ConfluencePage {
  readonly id: string;
  readonly title: string;
  readonly spaceId: string;
  readonly storage: string;
  readonly url: string;
}

interface RawPage {
  id: string;
  title: string;
  spaceId: string;
  body?: { storage?: { value?: string } };
  _links?: { webui?: string; base?: string };
}

/** Accepts a numeric page ID or a Confluence page URL like .../pages/123456/Title. */
export function parsePageId(input: string): string {
  const trimmed = input.trim();
  const fromUrl = /\/pages\/(\d+)/.exec(trimmed) ?? /[?&]pageId=(\d+)/.exec(trimmed);
  const id = fromUrl ? fromUrl[1] : trimmed;
  if (!/^\d{1,20}$/.test(id)) throw new Error("Enter a Confluence page URL or numeric page ID.");
  return id;
}

function pageUrl(raw: RawPage): string {
  const webui = raw._links?.webui ?? "";
  return raw._links?.base ? `${raw._links.base}${webui}` : `/wiki${webui}`;
}

export async function getPage(pageIdOrUrl: string): Promise<ConfluencePage> {
  const id = parsePageId(pageIdOrUrl);
  const res = await api.asApp().requestConfluence(route`/wiki/api/v2/pages/${id}?body-format=storage`);
  const raw = await readJson<RawPage>(res, `read Confluence page ${id}`);
  return { id: raw.id, title: raw.title, spaceId: raw.spaceId, storage: raw.body?.storage?.value ?? "", url: pageUrl(raw) };
}

export async function createChildPage(parent: Pick<ConfluencePage, "id" | "spaceId">, title: string, storage: string): Promise<{ id: string; url: string }> {
  const res = await api.asApp().requestConfluence(route`/wiki/api/v2/pages`, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ spaceId: parent.spaceId, parentId: parent.id, status: "current", title, body: { representation: "storage", value: storage } }),
  });
  const raw = await readJson<RawPage>(res, "create the change order page in Confluence");
  return { id: raw.id, url: pageUrl(raw) };
}
