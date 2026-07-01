import type { Logger } from '../logger.js';
import type { MessageRepo } from '../store/messages.js';
import type { SettingsRepo } from '../store/settings.js';
import type { SummaryRepo } from '../store/summaries.js';
import type { Summarizer } from '../summarize/summarizer.js';
import type { ChatInfo, SummaryWindow } from '../types.js';
import { formatTs } from '../util/time.js';
import { HELP_TEXT, parseCommand } from './parser.js';

const DAY = 24 * 3_600_000;

export interface CommandDeps {
  messages: MessageRepo;
  summaries: SummaryRepo;
  settings: SettingsRepo;
  summarizer: Summarizer;
  sendToSelf(text: string): Promise<void>;
  logger: Logger;
}

/** Executes commands arriving in the self-chat and replies there. */
export class CommandHandler {
  constructor(private readonly deps: CommandDeps) {}

  async handle(text: string): Promise<void> {
    const command = parseCommand(text, Date.now());
    if (!command) return;
    const { sendToSelf, logger } = this.deps;
    logger.info({ command: command.type }, 'self-chat command');

    try {
      switch (command.type) {
        case 'help':
          await sendToSelf(HELP_TEXT);
          return;
        case 'invalid':
          await sendToSelf(`⚠️ ${command.reason}`);
          return;
        case 'groups':
          await sendToSelf(this.renderGroups());
          return;
        case 'sum': {
          const window: SummaryWindow = command.window ?? {
            fromTs: Date.now() - DAY,
            toTs: Date.now(),
            label: 'last 24h',
          };
          await this.runSummary(command.group, window, true);
          return;
        }
        case 'unread': {
          const group = this.resolveGroup(command.group);
          if (typeof group === 'string') return sendToSelf(group);
          const since = this.deps.settings.getCatchupMarker(group.jid);
          const fromTs = since > 0 ? since : Date.now() - DAY;
          const window: SummaryWindow = {
            fromTs,
            toTs: Date.now(),
            label: since > 0 ? `since your last catch-up (${formatTs(since)})` : 'last 24h',
          };
          await this.runSummaryFor(group, window, true);
          return;
        }
        case 'topics-show': {
          const profile = this.deps.settings.getTopicProfile();
          await sendToSelf(
            profile
              ? `🎯 Your topics: ${profile.interests}\n(change with /topics set <text>)`
              : 'No topic profile set. Try: /topics set tech talks, event updates'
          );
          return;
        }
        case 'topics-set':
          this.deps.settings.setTopicProfile(command.interests, Date.now());
          await sendToSelf(`🎯 Topics saved: ${command.interests}`);
          return;
        case 'topics-clear':
          this.deps.settings.setTopicProfile('', Date.now());
          await sendToSelf('🎯 Topic profile cleared.');
          return;
        case 'schedule-list': {
          const schedules = this.deps.settings.getSchedules();
          if (schedules.length === 0) {
            await sendToSelf('No daily digests scheduled. Try: /schedule <group> 20:00');
            return;
          }
          const lines = schedules.map(
            (s) => `• ${this.deps.messages.chatName(s.chatJid) || s.chatJid} — daily at ${s.time}`
          );
          await sendToSelf(`*Scheduled digests*\n${lines.join('\n')}`);
          return;
        }
        case 'schedule-set': {
          const group = this.resolveGroup(command.group);
          if (typeof group === 'string') return sendToSelf(group);
          this.deps.settings.setSchedule(group.jid, command.time);
          await sendToSelf(`⏰ Daily digest for *${group.name}* at ${command.time}.`);
          return;
        }
        case 'schedule-off': {
          const group = this.resolveGroup(command.group);
          if (typeof group === 'string') return sendToSelf(group);
          this.deps.settings.setSchedule(group.jid, null);
          await sendToSelf(`⏰ Daily digest for *${group.name}* turned off.`);
          return;
        }
        case 'saved': {
          const recent = this.deps.summaries.listRecent(command.limit);
          if (recent.length === 0) {
            await sendToSelf('No saved summaries yet. Every /sum result is saved automatically.');
            return;
          }
          const lines = recent.map(
            (s) =>
              `#${s.id} *${s.chatName}* — ${formatTs(s.createdAt)} (${s.messageCount} msgs, ${formatTs(s.fromTs)} → ${formatTs(s.toTs)})`
          );
          await sendToSelf(`*Saved summaries* (browse full text in the dashboard)\n${lines.join('\n')}`);
          return;
        }
      }
    } catch (err) {
      logger.error({ err }, 'command failed');
      await sendToSelf(`❌ Something went wrong: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async runSummary(groupQuery: string, window: SummaryWindow, advanceMarker: boolean): Promise<void> {
    const group = this.resolveGroup(groupQuery);
    if (typeof group === 'string') {
      await this.deps.sendToSelf(group);
      return;
    }
    await this.runSummaryFor(group, window, advanceMarker);
  }

  private async runSummaryFor(group: ChatInfo, window: SummaryWindow, advanceMarker: boolean): Promise<void> {
    const { summarizer, settings, sendToSelf } = this.deps;
    await sendToSelf(`⏳ Summarizing *${group.name}* (${window.label})…`);
    const summary = await summarizer.summarize(group.jid, window);
    if (!summary) {
      await sendToSelf(`No messages in *${group.name}* for ${window.label}.`);
      return;
    }
    if (advanceMarker) settings.setCatchupMarker(group.jid, window.toTs);
    await sendToSelf(
      `*${group.name}* — ${window.label} (${summary.messageCount} messages)\n\n${summary.content}\n\n_Saved as summary #${summary.id}_`
    );
  }

  /** Resolve "#3" / name fragment / quoted name to a group; error text if ambiguous. */
  private resolveGroup(query: string): ChatInfo | string {
    const groups = this.deps.messages.listGroups();
    if (groups.length === 0) {
      return 'No groups recorded yet — messages are collected as they arrive after pairing.';
    }
    const indexMatch = /^#?(\d+)$/.exec(query.trim());
    if (indexMatch) {
      const group = groups[Number(indexMatch[1]) - 1];
      return group ?? `No group #${indexMatch[1]} — send /groups for the list.`;
    }
    const needle = query.toLowerCase();
    const matches = groups.filter((g) => g.name.toLowerCase().includes(needle));
    if (matches.length === 1) return matches[0]!;
    if (matches.length === 0) return `No group matching "${query}". Send /groups for the list.`;
    const options = matches.slice(0, 8).map((g, i) => `${i + 1}. ${g.name}`);
    return `"${query}" matches several groups — be more specific:\n${options.join('\n')}`;
  }

  private renderGroups(): string {
    const groups = this.deps.messages.listGroups();
    if (groups.length === 0) {
      return 'No groups recorded yet — they appear as messages arrive.';
    }
    const lines = groups.map((g, i) => {
      const last = g.lastMessageTs ? formatTs(g.lastMessageTs) : '—';
      return `#${i + 1} *${g.name || g.jid}* — ${g.messageCount} msgs, last ${last}`;
    });
    return `*Your groups*\n${lines.join('\n')}\n\nSummarize with: /sum #2 or /sum <name>`;
  }
}
