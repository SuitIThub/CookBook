import type { APIRoute } from 'astro';
import { db } from '../../../lib/database.server';
import { respond, withBody } from '../../../lib/trackerHttp';
import { diaryDelete, diaryGet, diaryPost, diaryPut } from '../../../lib/trackerService';

export const GET: APIRoute = async ({ url }) => {
  const params = new URL(url).searchParams;
  return respond(diaryGet(db, { id: params.get('id'), alias: params.get('alias'), from: params.get('from'), to: params.get('to') }));
};

export const POST: APIRoute = async ({ request }) => withBody(request, 'POST /api/tracker/diary', (body) => diaryPost(db, body));

export const PUT: APIRoute = async ({ request }) => withBody(request, 'PUT /api/tracker/diary', (body) => diaryPut(db, body));

export const DELETE: APIRoute = async ({ url }) => respond(diaryDelete(db, new URL(url).searchParams.get('id')));
