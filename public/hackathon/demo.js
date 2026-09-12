// Small browser bridge for the trigger-only demo. The agent calls the HTTP
// endpoints; these pages only observe the session and render each transition.
window.HackathonDemo = (() => {
  const API = "/v1/demo";
  const params = new URLSearchParams(location.search);
  const sessionId = params.get("sessionId") || params.get("session");
  const request = async (path, options = {}) => {
    const response = await fetch(API + path, { headers: { "content-type": "application/json" }, ...options });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "demo_request_failed");
    return body;
  };
  const sessionUrl = (page, id) => `${page}?sessionId=${encodeURIComponent(id)}`;
  return {
    sessionId,
    sessionUrl,
    create: (email) => request("/sessions", { method: "POST", body: JSON.stringify({ email }) }),
    get: (id = sessionId) => request(`/sessions/${encodeURIComponent(id)}`),
    trigger: (action, payload = {}, id = sessionId) => request(`/trigger/${action}`, { method: "POST", body: JSON.stringify({ sessionId: id, ...payload }) }),
    watch(id, callback, interval = 350) {
      if (!id) return () => {};
      let stopped = false;
      let last = "";
      const tick = async () => {
        if (stopped) return;
        try { const state = await request(`/sessions/${encodeURIComponent(id)}`); const key = `${state.stage}:${state.updatedAt}`; if (key !== last) { last = key; callback(state); } } catch (_) { /* server may be starting */ }
        if (!stopped) setTimeout(tick, interval);
      };
      tick();
      return () => { stopped = true; };
    },
  };
})();
