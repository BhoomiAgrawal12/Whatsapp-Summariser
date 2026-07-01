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

  if (method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
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
      const body = await readJson(req);
      const { chatJid, fromTs, toTs } = body as { chatJid?: string; fromTs?: number; toTs?: number };
      if (!chatJid || typeof fromTs !== 'number' || typeof toTs !== 'number' || fromTs > toTs) {
        return json(res, 400, { error: 'expected { chatJid, fromTs, toTs }' });
      }
      const label = `${new Date(fromTs).toLocaleString()} → ${new Date(toTs).toLocaleString()}`;
      const summary = await deps.summarizer.summarize(chatJid, { fromTs, toTs, label });
      return summary
        ? json(res, 200, summary)
        : json(res, 200, { empty: true, message: 'No messages in that range.' });
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
      return json(res, 200, {
        target: messageId,
        messages: deps.messages.context(messageId, Math.min(radius, 100)),
      });
    }

    default:
      return json(res, 404, { error: 'not found' });
  }
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
