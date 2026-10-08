import type { APIRoute } from 'astro';
import { db } from '../../../lib/database.server';
import { respond, withBody } from '../../../lib/trackerHttp';
import { weightDelete, weightGet, weightPost } from '../../../lib/trackerService';

export const GET: APIRoute = async ({ url }) => respond(weightGet(db, new URL(url).searchParams.get('alias')));

export const POST: APIRoute = async ({ request }) => withBody(request, 'POST /api/tracker/weight', (body) => weightPost(db, body));

export const DELETE: APIRoute = async ({ url }) => respond(weightDelete(db, new URL(url).searchParams.get('id')));
