import { loadConfig } from './config.js';
import { createLogger } from './logger.js';
import { CommandHandler } from './commands/handler.js';
import { Ingestor } from './ingest/ingest.js';
import { createProvider } from './llm/provider.js';
import { Scheduler } from './scheduler.js';
import { openDb } from './store/db.js';
import { MessageRepo } from './store/messages.js';
import { SettingsRepo } from './store/settings.js';
import { StarredRepo } from './store/starred.js';
import { SummaryRepo } from './store/summaries.js';
import { Summarizer } from './summarize/summarizer.js';
import { WaConnection } from './wa/connection.js';
import { startWebServer } from './web/server.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config.logLevel);
  logger.info(
    { provider: config.llmProvider, model: config.openaiModel, credential: config.credentialShape },
    'starting WhatsApp summarizer'
  );
  // Surfaced loudly: these are the cases where the value being used is not the
  // one the config file appears to specify.
  for (const warning of config.warnings) logger.warn(`config: ${warning}`);

  const db = openDb(config.dataDir);
  const messages = new MessageRepo(db);
  const summaries = new SummaryRepo(db);
  const starred = new StarredRepo(db);
  const settings = new SettingsRepo(db);

  const provider = createProvider(config);
  const summarizer = new Summarizer(provider, messages, summaries, settings, logger, {
    publicUrl: config.publicUrl,
  });

  // sendToSelf is late-bound: the connection is constructed after the handlers.
  const sendToSelf = async (text: string): Promise<void> => conn.sendToSelf(text);

  const commands = new CommandHandler({ messages, summaries, settings, summarizer, sendToSelf, logger });
  const ingestor = new Ingestor(messages, starred, config.dataDir, logger, async (text) =>
    commands.handle(text)
  );

  const conn = new WaConnection(config.authDir, logger, {
    onMessages: async (batch, source) => ingestor.handleMessages(batch, source),
    onGroups: (groups) => ingestor.registerGroups(groups),
    onReady: async () => {
      logger.info('ready — send /help to yourself in WhatsApp (Message Yourself chat)');
    },
  });
  ingestor.attach(conn);

  const scheduler = new Scheduler({ settings, messages, summarizer, sendToSelf, logger });
  scheduler.start();

  const web = startWebServer(
    { messages, summaries, starred, settings, summarizer, dataDir: config.dataDir, logger },
    config.dashboardPort,
    config.dashboardHost
  );

  const shutdown = (): void => {
    logger.info('shutting down');
    scheduler.stop();
    web.close();
    conn.stop();
    db.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  await conn.start();
}

main().catch((err: unknown) => {
  console.error('fatal:', err);
  process.exit(1);
});
