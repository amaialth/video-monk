// API client: JSON helpers and the live event stream for a project.
async function call(method, url, body) {
  const res = await fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined, credentials: 'same-origin' });
  let data = null;
  try { data = await res.json(); } catch { /* not JSON */ }
  if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
  return data;
}
export const api = {
  get: url => call('GET', url), post: (url, body = {}) => call('POST', url, body), del: url => call('DELETE', url),
  session: () => api.get('/api/session'), env: () => api.get('/api/env'), questions: () => api.get('/api/brief/questions'),
  roots: () => api.get('/api/fs/roots'), list: p => api.get(`/api/fs/list?path=${encodeURIComponent(p || '')}`), probe: p => api.get(`/api/fs/probe?path=${encodeURIComponent(p)}`),
  thumb: (p, t) => `/api/fs/thumb?path=${encodeURIComponent(p)}${t === undefined ? '' : `&t=${t}`}`,
  projects: () => api.get('/api/projects'), project: id => api.get(`/api/projects/${id}`), create: body => api.post('/api/projects', body), importProject: body => api.post('/api/projects/import', body),
  start: id => api.post(`/api/projects/${id}/start`), cancel: id => api.post(`/api/projects/${id}/cancel`), duplicate: id => api.post(`/api/projects/${id}/duplicate`), remove: id => api.del(`/api/projects/${id}`),
  data: (id, name) => api.get(`/api/projects/${id}/data/${name}`), gate: (id, gate, body) => api.post(`/api/projects/${id}/gates/${gate}`, body),
  action: (id, name, body) => api.post(`/api/projects/${id}/actions/${name}`, body), library: (q, kind) => api.get(`/api/library?q=${encodeURIComponent(q || '')}${kind ? `&kind=${kind}` : ''}`),
  resume: id => api.post(`/api/projects/${id}/resume`), runs: id => api.get(`/api/projects/${id}/runs`),
  presets: () => api.get('/api/presets'), savePreset: (name, options) => api.post('/api/presets', { name, options }), deletePreset: id => api.del(`/api/presets/${id}`),
  terms: () => api.get('/api/terms'), toggleTerm: (heard, term, enabled) => api.post('/api/terms/toggle', { heard, term, enabled }), deleteTerm: (heard, term) => api.post('/api/terms/delete', { heard, term }),
  recent: () => api.get('/api/recent'), approvals: () => api.get('/api/approvals'), db: () => api.get('/api/db'),
  motion: () => api.get('/api/motion'), checkBrief: brief => api.post('/api/motion/brief/check', { brief }), planVideo: body => api.post('/api/motion/video', body),
  addLib: (id, confirm) => api.post('/api/libs/add', { id, confirm }), removeLib: id => api.post('/api/libs/remove', { id }),
  // a still as an object URL; a failure comes back as its message (the server answers errors as JSON)
  async still(url) {
    const res = await fetch(url, { credentials: 'same-origin' });
    if (!res.ok) { let m = `Request failed (${res.status})`; try { m = (await res.json()).error || m; } catch { /* not JSON */ } throw new Error(m); }
    return URL.createObjectURL(await res.blob());
  },
  source: id => `/api/projects/${id}/source`
};

// Live events with automatic replay: the server resends everything after the last seen sequence number on reconnect.
export function subscribe(id, onEvent, onState = () => {}) {
  let last = 0, source = null, closed = false, retry = 0;
  const open = () => {
    if (closed) return;
    source = new EventSource(`/api/projects/${id}/events?after=${last}`);
    source.onopen = () => { retry = 0; onState(true); };
    source.onmessage = m => { try { const e = JSON.parse(m.data); last = Math.max(last, e.seq); onEvent(e); } catch { /* ignore */ } };
    source.onerror = () => { onState(false); source.close(); if (!closed) setTimeout(open, Math.min(8000, 800 * ++retry)); };
  };
  open();
  return () => { closed = true; source?.close(); };
}
