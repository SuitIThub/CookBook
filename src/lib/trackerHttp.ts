import type { ServiceResult } from './trackerService';

export function respond(result: ServiceResult): Response {
  return new Response(JSON.stringify(result.body), {
    status: result.status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Parse the JSON body and run the handler; unexpected failures become a 500 (as before). */
export async function withBody(request: Request, label: string, handler: (body: any) => ServiceResult): Promise<Response> {
  try {
    return respond(handler(await request.json()));
  } catch (error) {
    console.error(`${label} error:`, error);
    return respond({ status: 500, body: { error: 'Internal server error' } });
  }
}
