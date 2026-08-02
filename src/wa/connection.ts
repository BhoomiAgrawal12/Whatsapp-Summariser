import makeWASocket, {
  DisconnectReason,
  downloadMediaMessage,
  fetchLatestBaileysVersion,
  fetchLatestWaWebVersion,
  jidNormalizedUser,
  useMultiFileAuthState,
  proto,
  type WAMessage,
  type WAVersion,
} from 'baileys';
import type { Boom } from '@hapi/boom';
import QRCode from 'qrcode';
import type { Logger } from '../logger.js';

type WaSocket = ReturnType<typeof makeWASocket>;

export interface WaHandlers {
  /** Live + history messages (deduplicated downstream by wa message id). */
  onMessages(messages: WAMessage[], source: 'live' | 'history'): Promise<void>;
  /** Group jid -> subject, fetched after connecting. */
  onGroups(groups: Map<string, string>): void;
  /** Fired once per (re)connect when the socket is usable. */
  onReady(): Promise<void>;
}

/**
 * Owns the Baileys socket lifecycle: QR pairing, credential persistence and
 * automatic reconnects. Deliberately NEVER calls readMessages and keeps
 * markOnlineOnConnect off, so the phone keeps its unread state/notifications.
 */
export class WaConnection {
  private sock: WaSocket | null = null;
  private stopped = false;
  /** Own jids (phone number jid + lid); self-chat messages match one of these. */
  private selfJids = new Set<string>();

  constructor(
    private readonly authDir: string,
    private readonly logger: Logger,
    private readonly handlers: WaHandlers
  ) {}

  /**
   * baileys ships a hardcoded WhatsApp-Web version that goes stale between
   * releases. Once WhatsApp stops accepting it the handshake is rejected with
   * statusCode 405 and the socket closes *before* a pairing QR is ever issued —
   * so the symptom is "no QR", not an auth error. Always advertise a live
   * version, preferring web.whatsapp.com itself, and only fall back to the
   * bundled default if both lookups fail (e.g. offline).
   */
  private async resolveWaVersion(): Promise<WAVersion | undefined> {
    for (const fetchVersion of [fetchLatestWaWebVersion, fetchLatestBaileysVersion]) {
      try {
        const { version } = await fetchVersion();
        this.logger.info({ version, source: fetchVersion.name }, 'using WhatsApp Web version');
        return version;
      } catch (err) {
        this.logger.warn({ err, source: fetchVersion.name }, 'WA version lookup failed');
      }
    }
    this.logger.warn('falling back to the WA version bundled with baileys (may be rejected)');
    return undefined;
  }

  async start(): Promise<void> {
    const { state, saveCreds } = await useMultiFileAuthState(this.authDir);
    const version = await this.resolveWaVersion();
    const sock = makeWASocket({
      auth: state,
      ...(version ? { version } : {}),
      // Do not announce presence: keeps phone notifications intact and profile silent.
      markOnlineOnConnect: false,
      syncFullHistory: true,
      // pino only honours `level` as the SECOND argument; putting it inside the
      // bindings object makes it a logged field and leaves the child at the
      // parent's level, which buries the pairing QR under baileys' info chatter.
      logger: this.logger.child({ module: 'baileys' }, { level: 'warn' }),
    });
    this.sock = sock;

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
      void (async () => {
        if (update.qr) {
          const rendered = await QRCode.toString(update.qr, { type: 'terminal', small: true });
          // Intentionally console (not logger): the QR must render cleanly.
          console.log('\nScan this QR in WhatsApp → Settings → Linked devices → Link a device:\n');
          console.log(rendered);
        }
        if (update.connection === 'open') {
          this.rememberSelfJids(sock);
          this.logger.info({ jid: [...this.selfJids][0] }, 'connected to WhatsApp');
          await this.refreshGroups();
          await this.handlers.onReady();
        }
        if (update.connection === 'close') {
          const statusCode = (update.lastDisconnect?.error as Boom | undefined)?.output
            ?.statusCode;
          if (statusCode === DisconnectReason.loggedOut) {
            this.logger.error(
              'logged out by WhatsApp — delete the auth/ directory and re-pair'
            );
            return;
          }
          if (!this.stopped) {
            // Includes the expected restartRequired right after QR pairing.
            this.logger.warn({ statusCode }, 'connection closed, reconnecting');
            await this.start();
          }
        }
      })();
    });

    sock.ev.on('messages.upsert', ({ messages }) => {
      void this.safely(() => this.handlers.onMessages(messages, 'live'), 'messages.upsert');
    });

    sock.ev.on('messaging-history.set', ({ messages, chats }) => {
      // History sync also tells us chat display names.
      const groups = new Map<string, string>();
      for (const chat of chats) {
        if (chat.id?.endsWith('@g.us') && chat.name) groups.set(chat.id, chat.name);
      }
      if (groups.size > 0) this.handlers.onGroups(groups);
      void this.safely(() => this.handlers.onMessages(messages, 'history'), 'history.set');
    });

    sock.ev.on('groups.upsert', (metas) => {
      const groups = new Map<string, string>();
      for (const meta of metas) groups.set(meta.id, meta.subject);
      this.handlers.onGroups(groups);
    });
  }

  stop(): void {
    this.stopped = true;
    this.sock?.end(undefined);
  }

  private async safely(fn: () => Promise<void>, label: string): Promise<void> {
    try {
      await fn();
    } catch (err) {
      this.logger.error({ err, label }, 'handler failed');
    }
  }

  private rememberSelfJids(sock: WaSocket): void {
    if (sock.user?.id) this.selfJids.add(jidNormalizedUser(sock.user.id));
    if (sock.user?.lid) this.selfJids.add(jidNormalizedUser(sock.user.lid));
  }

  /** The "Message Yourself" chat jid (phone-number form). */
  get ownJid(): string {
    const sock = this.mustSock();
    if (!sock.user?.id) throw new Error('not connected yet');
    return jidNormalizedUser(sock.user.id);
  }

  isSelfChat(jid: string): boolean {
    return this.selfJids.has(jidNormalizedUser(jid));
  }

  async refreshGroups(): Promise<void> {
    try {
      const all = await this.mustSock().groupFetchAllParticipating();
      const groups = new Map<string, string>();
      for (const [jid, meta] of Object.entries(all)) groups.set(jid, meta.subject);
      this.handlers.onGroups(groups);
    } catch (err) {
      this.logger.warn({ err }, 'groupFetchAllParticipating failed');
    }
  }

  /** Send a text message to the user's own "Message Yourself" chat. */
  async sendToSelf(text: string): Promise<void> {
    await this.mustSock().sendMessage(this.ownJid, { text });
  }

  /** Download media of a stored raw message (asks the phone to re-upload if expired). */
  async downloadMedia(encoded: Buffer): Promise<Buffer> {
    const sock = this.mustSock();
    const msg = proto.WebMessageInfo.decode(encoded) as WAMessage;
    return downloadMediaMessage(
      msg,
      'buffer',
      {},
      { logger: this.logger, reuploadRequest: sock.updateMediaMessage }
    );
  }

  private mustSock(): WaSocket {
    if (!this.sock) throw new Error('WhatsApp connection not started');
    return this.sock;
  }
}
