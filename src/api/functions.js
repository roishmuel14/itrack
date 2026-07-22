import { base44 } from '@/api/base44Client';

// Every function response body sits on `.data` (axios-style envelope):
// reading the top level is a bug (hard rule 6). Business failures carry
// { error, reasons: [{ code, message }] } and are thrown as FunctionError
// so the UI can map reasons[] to toasts verbatim.
export class FunctionError extends Error {
  constructor(message, { reasons = [], status = 0 } = {}) {
    super(message);
    this.name = 'FunctionError';
    this.reasons = reasons;
    this.status = status;
  }
}

export async function invokeFunction(name, payload = {}) {
  let response;
  try {
    response = await base44.functions.invoke(name, payload);
  } catch (err) {
    // SDK throws on non-2xx; the server's JSON body is on err.response.data.
    const body = err?.response?.data;
    if (body?.error) {
      throw new FunctionError(body.error, {
        reasons: Array.isArray(body.reasons) ? body.reasons : [],
        status: err?.response?.status ?? 0,
      });
    }
    throw new FunctionError(err?.message || 'Request failed', { status: err?.response?.status ?? 0 });
  }
  const data = response?.data ?? response;
  if (data && typeof data === 'object' && data.error) {
    throw new FunctionError(data.error, { reasons: data.reasons ?? [], status: 200 });
  }
  return data;
}
