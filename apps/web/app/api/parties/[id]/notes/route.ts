import { addPartyNote, listPartyNotes, removePartyNote } from '@kora/core';
import { isUuid, json, readJson, tenantRoute } from '../../../../../lib/server';

export const GET = tenantRoute(async ({ t, sql, params }) => {
  if (!isUuid(params.id!)) return json({ error: 'Customer not found.' }, 404);
  return { notes: await listPartyNotes(sql, t, params.id!) };
});

/** Body: { body }. */
export const POST = tenantRoute(async ({ t, sql, req, params }) => {
  if (!isUuid(params.id!)) return json({ error: 'Customer not found.' }, 404);
  return addPartyNote(sql, t, params.id!, String((await readJson(req)).body ?? ''));
});

/** ?note=id. The writer or an owner can remove a note. */
export const DELETE = tenantRoute(async ({ t, sql, req, params }) => {
  const note = new URL(req.url).searchParams.get('note') ?? '';
  if (!isUuid(params.id!) || !isUuid(note)) return json({ error: 'Note not found.' }, 404);
  await removePartyNote(sql, t, params.id!, note);
});
