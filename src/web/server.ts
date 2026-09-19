import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Logger } from '../logger.js';
import type { MessageRepo } from '../store/messages.js';
import type { SettingsRepo } from '../store/settings.js';
import type { StarredRepo } from '../store/starred.js';
import type { SummaryRepo } from '../store/summaries.js';
import type { Summarizer } from '../summarize/summarizer.js';
import { parseWindowPhrase } from '../commands/parser.js';
import { formatRange } from '../util/time.js';

const MEDIA_MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  mp4: 'video/mp4',
  ogg: 'audio/ogg',
  pdf: 'application/pdf',
};

export interface WebDeps {
  messages: MessageRepo;
  summaries: SummaryRepo;
  starred: StarredRepo;
  settings: SettingsRepo;
  summarizer: Summarizer;
  dataDir: string;
  logger: Logger;
}

/**
 * Minimal dependency-free HTTP server for the dashboard.
 * Bound to localhost by default — it is unauthenticated by design (personal tool);
 * expose beyond localhost only on a trusted network.
 */
export function startWebServer(deps: WebDeps, port: number, host = '127.0.0.1'): Server {
  const server = createServer((req, res) => {
    void route(deps, req, res).catch((err: unknown) => {
      deps.logger.error({ err, url: req.url }, 'web request failed');
      if (!res.headersSent) json(res, 500, { error: err instanceof Error ? err.message : 'internal error' });
    });
  });
  server.listen(port, host, () => {
    deps.logger.info({ url: `http://${host}:${port}` }, 'dashboard running');
  });
  return server;
}

async function route(deps: WebDeps, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const method = req.method ?? 'GET';
  const segments = url.pathname.split('/').filter(Boolean);

  // "/m/<messageId>" is the deep link used by citation footers in WhatsApp
  // digests. It serves the same single-page dashboard, which reads the path on
  // boot and opens that message's context view.
  const isDeepLink = method === 'GET' && segments[0] === 'm' && segments.length === 2;

  if (method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html' || isDeepLink)) {
    const htmlPath = fileURLToPath(new URL('./public/index.html', import.meta.url));
    const html = await readFile(htmlPath);
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(html);
    return;
  }

  if (segments[0] === 'media' && method === 'GET') {
    return serveMedia(deps, segments.slice(1), res);
  }

  if (segments[0] !== 'api') return json(res, 404, { error: 'not found' });

  switch (`${method} ${segments[1] ?? ''}`) {
    case 'GET groups':
      return json(res, 200, deps.messages.listGroups());

    case 'GET summaries': {
      if (segments[2] !== undefined) {
        const summary = deps.summaries.get(Number(segments[2]));
        return summary ? json(res, 200, summary) : json(res, 404, { error: 'not found' });
      }
      const limit = Number(url.searchParams.get('limit') ?? '30');
      return json(res, 200, deps.summaries.listRecent(Number.isFinite(limit) ? limit : 30));
    }

    case 'POST summarize': {
      const body = (await readJson(req)) as {
        chatJid?: string;
        fromTs?: number;
        toTs?: number;
        /** Alternative to fromTs/toTs: any phrase /sum accepts ("yesterday", "2026-07-01..2026-07-03"). */
        window?: string;
      };
      if (!body.chatJid) return json(res, 400, { error: 'expected { chatJid, ... }' });

      const window = resolveWindow(body);
      if (typeof window === 'string') return json(res, 400, { error: window });

      const summary = await deps.summarizer.summarize(body.chatJid, window);
      return summary
        ? json(res, 200, summary)
        : json(res, 200, {
            empty: true,
            message: `No messages in ${formatRange(window.fromTs, window.toTs)}.`,
          });
    }

    case 'GET starred':
      return json(res, 200, deps.starred.list());

    case 'GET topics':
      return json(res, 200, deps.settings.getTopicProfile() ?? { interests: '', updatedAt: 0 });

    case 'POST topics': {
      const body = await readJson(req);
      const interests = typeof (body as { interests?: unknown }).interests === 'string'
        ? (body as { interests: string }).interests
        : '';
      deps.settings.setTopicProfile(interests, Date.now());
      return json(res, 200, { ok: true });
    }

    case 'GET schedules':
      return json(res, 200, deps.settings.getSchedules());

    case 'POST schedules': {
      const body = await readJson(req) as { chatJid?: string; time?: string | null };
      if (!body.chatJid) return json(res, 400, { error: 'expected { chatJid, time|null }' });
      if (body.time != null && !/^\d{2}:\d{2}$/.test(body.time)) {
        return json(res, 400, { error: 'time must be "HH:MM"' });
      }
      deps.settings.setSchedule(body.chatJid, body.time ?? null);
      return json(res, 200, { ok: true });
    }

    case 'GET context': {
      const messageId = Number(segments[2]);
      if (!Number.isInteger(messageId)) return json(res, 400, { error: 'bad message id' });
      const radius = Number(url.searchParams.get('radius') ?? '15');
      const target = deps.messages.getById(messageId);
      if (!target) return json(res, 404, { error: 'message not found' });
      return json(res, 200, {
        target: messageId,
        chatJid: target.chatJid,
        chatName: deps.messages.chatName(target.chatJid) || target.chatJid,
        messages: deps.messages.context(messageId, Math.min(radius, 100)),
      });
    }

    default:
      return json(res, 404, { error: 'not found' });
  }
}

/**
 * Accept either an explicit millisecond range or a `window` phrase (the same
 * grammar the /sum command uses), and always hand back a window carrying an
 * unambiguous human label. Returns an error string when the input is unusable.
 */
function resolveWindow(body: { fromTs?: number; toTs?: number; window?: string }):
  | { fromTs: number; toTs: number; label: string }
  | string {
  if (typeof body.window === 'string' && body.window.trim()) {
    const parsed = parseWindowPhrase(body.window, Date.now());
    return parsed ?? `Could not read "${body.window}" as a date window.`;
  }
  const { fromTs, toTs } = body;
  if (typeof fromTs !== 'number' || typeof toTs !== 'number' || !Number.isFinite(fromTs) || !Number.isFinite(toTs)) {
    return 'expected { chatJid, fromTs, toTs } or { chatJid, window }';
  }
  // Tolerate a reversed range rather than rejecting it — the picker makes it easy to swap.
  const [from, to] = fromTs <= toTs ? [fromTs, toTs] : [toTs, fromTs];
  return { fromTs: from, toTs: to, label: formatRange(from, to) };
}

async function serveMedia(deps: WebDeps, parts: string[], res: ServerResponse): Promise<void> {
  const mediaRoot = path.join(deps.dataDir, 'media');
  const target = path.normalize(path.join(mediaRoot, ...parts));
  if (!target.startsWith(mediaRoot + path.sep)) return json(res, 403, { error: 'forbidden' });
  try {
    const data = await readFile(target);
    const ext = path.extname(target).slice(1);
    res.writeHead(200, { 'content-type': MEDIA_MIME[ext] ?? 'application/octet-stream' });
    res.end(data);
  } catch {
    json(res, 404, { error: 'media not found' });
  }
}

function json(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const text = Buffer.concat(chunks).toString('utf8');
  return text ? (JSON.parse(text) as unknown) : {};
}
