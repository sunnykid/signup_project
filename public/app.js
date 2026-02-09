async function api(path, opts) {
  const r = await fetch(path, opts);
  const ct = r.headers.get("content-type") || "";
  const body = ct.includes("application/json") ? await r.json() : await r.text();
  if (!r.ok) throw new Error(typeof body === "string" ? body : JSON.stringify(body));
  return body;
}

function setOut(sel, v) {
  document.querySelector(sel).textContent =
    typeof v === "string" ? v : JSON.stringify(v, null, 2);
}

function getToken() {
  return localStorage.getItem("token");
}
function setToken(t) {
  localStorage.setItem("token", t);
}

async function main() {
  try {
    const info = await api("/api/info");
    setOut("#outInfo", info);
  } catch (e) {
    setOut("#outInfo", e.message);
  }

  document.querySelector("#formSignup").addEventListener("submit", async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(e.target).entries());
    try {
      const out = await api("/api/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      setOut("#outSignup", out);
    } catch (err) {
      setOut("#outSignup", err.message);
    }
  });

  document.querySelector("#formLogin").addEventListener("submit", async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(e.target).entries());
    try {
      const out = await api("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      setToken(out.token);
      setOut("#outLogin", out);
    } catch (err) {
      setOut("#outLogin", err.message);
    }
  });

  document.querySelector("#btnMe").addEventListener("click", async () => {
    try {
      const token = getToken();
      const out = await api("/api/me", {
        headers: { "Authorization": `Bearer ${token}` }
      });
      setOut("#outLogin", out);
    } catch (err) {
      setOut("#outLogin", err.message);
    }
  });

  document.querySelector("#btnLogout").addEventListener("click", async () => {
    try {
      const token = getToken();
      const out = await api("/api/logout", {
        method: "POST",
        headers: { "Authorization": `Bearer ${token}` }
      });
      localStorage.removeItem("token");
      setOut("#outLogin", out);
    } catch (err) {
      setOut("#outLogin", err.message);
    }
  });

  document.querySelector("#btnEvents").addEventListener("click", async () => {
    try {
      const out = await api("/api/events?limit=50");
      setOut("#outEvents", out);
    } catch (err) {
      setOut("#outEvents", err.message);
    }
  });

  document.querySelector("#btnStats").addEventListener("click", async () => {
    try {
      const out = await api("/api/events/stats?minutes=60");
      setOut("#outEvents", out);
    } catch (err) {
      setOut("#outEvents", err.message);
    }
  });

  document.querySelector("#btnSearch").addEventListener("click", async () => {
    try {
      const key = document.querySelector("#searchKey").value.trim();
      const value = document.querySelector("#searchValue").value.trim();
      const out = await api(`/api/events/search?key=${encodeURIComponent(key)}&value=${encodeURIComponent(value)}`);
      setOut("#outEvents", out);
    } catch (err) {
      setOut("#outEvents", err.message);
    }
  });
}

main();
