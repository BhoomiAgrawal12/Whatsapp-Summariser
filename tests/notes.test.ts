import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openDb, type Db } from '../src/store/db.js';
import { NotesRepo } from '../src/store/notes.js';

describe('NotesRepo', () => {
  let dir: string;
  let db: Db;
  let notes: NotesRepo;
  const NOW = 1_800_000_000_000;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'wa-notes-'));
    db = openDb(dir);
    notes = new NotesRepo(db);
  });

  afterEach(async () => {
    db.close();
    await rm(dir, { recursive: true, force: true });
  });

  const titles = (): string[] => notes.list().map((n) => n.title);

  it('creates a note and returns it fully populated', () => {
    const note = notes.create({ title: 'Packing list', body: 'tent, torch' }, NOW);
    assert.equal(note.title, 'Packing list');
    assert.equal(note.body, 'tent, torch');
    assert.equal(note.createdAt, NOW);
    assert.equal(note.updatedAt, NOW);
    assert.equal(note.chatJid, null);
    assert.deepEqual(notes.list().map((n) => n.id), [note.id]);
  });

  it('puts new notes at the top', () => {
    notes.create({ title: 'first' }, NOW);
    notes.create({ title: 'second' }, NOW);
    notes.create({ title: 'third' }, NOW);
    // The note just written is the one being worked on.
    assert.deepEqual(titles(), ['third', 'second', 'first']);
  });

  it('records optional provenance', () => {
    const note = notes.create(
      { title: 'From a digest', body: 'x', chatJid: 'g@g.us', source: 'from summary #7' },
      NOW
    );
    assert.equal(note.chatJid, 'g@g.us');
    assert.equal(note.source, 'from summary #7');
  });

  it('updates a note and bumps updatedAt, leaving createdAt alone', () => {
    const note = notes.create({ title: 'draft', body: 'rough' }, NOW);
    const updated = notes.update(note.id, { title: 'final', body: 'polished' }, NOW + 5000);
    assert.equal(updated?.title, 'final');
    assert.equal(updated?.body, 'polished');
    assert.equal(updated?.createdAt, NOW);
    assert.equal(updated?.updatedAt, NOW + 5000);
  });

  it('supports partial updates', () => {
    const note = notes.create({ title: 'keep me', body: 'old body' }, NOW);
    const updated = notes.update(note.id, { body: 'new body' }, NOW + 1);
    assert.equal(updated?.title, 'keep me');
    assert.equal(updated?.body, 'new body');
  });

  it('returns null when updating a note that does not exist', () => {
    assert.equal(notes.update(999, { title: 'nope' }, NOW), null);
  });

  it('deletes a note and reports whether anything was removed', () => {
    const note = notes.create({ title: 'temp', body: '' }, NOW);
    assert.equal(notes.remove(note.id), true);
    assert.deepEqual(notes.list(), []);
    assert.equal(notes.remove(note.id), false, 'second delete removes nothing');
  });

  it('applies an explicit order', () => {
    const a = notes.create({ title: 'a', body: '' }, NOW);
    const b = notes.create({ title: 'b', body: '' }, NOW);
    const c = notes.create({ title: 'c', body: '' }, NOW);
    notes.reorder([a.id, b.id, c.id]);
    assert.deepEqual(titles(), ['a', 'b', 'c']);
    notes.reorder([c.id, a.id, b.id]);
    assert.deepEqual(titles(), ['c', 'a', 'b']);
  });

  it('keeps unlisted notes after the listed ones, in their previous order', () => {
    const a = notes.create({ title: 'a', body: '' }, NOW);
    const b = notes.create({ title: 'b', body: '' }, NOW);
    const c = notes.create({ title: 'c', body: '' }, NOW);
    // Current order is c, b, a. Move only `a` to the front.
    notes.reorder([a.id]);
    assert.deepEqual(titles(), ['a', 'c', 'b']);
    assert.ok([a.id, b.id, c.id].every((id) => notes.get(id) !== null), 'nothing was dropped');
  });

  it('survives reordering with an id that no longer exists', () => {
    const a = notes.create({ title: 'a', body: '' }, NOW);
    const b = notes.create({ title: 'b', body: '' }, NOW);
    notes.reorder([999, b.id, a.id]);
    assert.deepEqual(titles(), ['b', 'a']);
  });

  it('keeps a note after the chat it came from is forgotten', () => {
    // Notes hold no foreign key on purpose — deleting messages must not cascade.
    const note = notes.create({ title: 'survives', body: 'text', chatJid: 'gone@g.us' }, NOW);
    db.prepare('DELETE FROM chats').run();
    db.prepare('DELETE FROM messages').run();
    assert.equal(notes.get(note.id)?.title, 'survives');
  });
});
