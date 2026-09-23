// app-source/source-web/desktop-session.js
var isDesktop = true;
var openExternal = (url) => window.ivShell.openExternal(url);
window.ivShell.onAuthStatus((text) => window.dispatchEvent(new CustomEvent("iv-auth-status", { detail: text })));
var api = Object.fromEntries(["get", "post", "put", "delete"].map((m) => [m, async (path, data) => ({ data: await window.ivShell.request(m.toUpperCase(), path, data) })]));

// app-source/classic-source/ai-mixer.js
function mountMixer() {
  if (document.getElementById("infectedMixer")) return;
  const box = document.createElement("section");
  box.id = "infectedMixer";
  box.className = "mixbox";
  box.innerHTML = `
    <h3>Infected Mixer</h3>
    <p>Mix and master your vocals over your beat with RoEx. Your original performance is used; no replacement voice is generated.</p>
    <details><summary>AI settings \xB7 your API key</summary>
      <label>RoEx Tonn API key<input id="roexKey" type="password" autocomplete="off" spellcheck="false" placeholder="Paste your own funded API key"></label>
      <button id="clearRoexKey">Clear key</button><button id="roexAccount">Open RoEx account</button>
      <p class="hint">The key stays in this page's memory and is sent securely to our server for RoEx requests. It is not saved. RoEx credits are separate from your Infected Voices subscription.</p>
    </details>
    <label>Workflow<select id="aiWorkflow"><option value="standard">Infected Mixer \xB7 automatic mix & master</option><option value="grim">Grim Beats \xB7 detailed vocal preparation</option></select></label>
    <p class="hint">Grim Beats measures each vocal and checks for clipping and silence before mixing. Both workflows use RoEx. Preview the result to choose the sound you prefer.</p>
    <div class="grid"><label>Music style<select id="aiStyle"><option value="HIPHOP_GRIME">Hip-hop / Grime</option><option value="TRAP">Trap</option><option value="ELECTRONIC">Electronic</option><option value="POP">Pop / singing</option><option value="ROCK_INDIE">Rock</option><option value="METAL">Metal</option><option value="ACOUSTIC">Acoustic</option></select></label>
    <label>Master loudness<select id="aiLoudness"><option value="LOW">Dynamic</option><option value="MEDIUM" selected>Balanced</option><option value="HIGH">Loud</option></select></label>
    <label>Vocal trim / dB<input id="aiVocalGain" type="number" min="-6" max="6" step="0.5" value="0"></label></div>
    <label><input id="aiTune" type="checkbox" checked> Apply local pitch correction using my song and section keys</label>
    <p class="hint">Tuning and Pocket timing run locally. Use Rap on beat \u2192 preview \u2192 Keep correction before starting the AI mix. RoEx does not tune or time-align audio.</p>
    <label><input id="aiUploadConsent" type="checkbox"> Upload this project's vocal and beat audio to RoEx for processing</label>
    <button id="startAiMix" class="primary wide">Prepare & create AI preview</button>
    <button id="checkAiMix" hidden>Check current mix / retry</button>
    <p id="aiMixStatus" role="status" aria-live="polite"></p>
    <audio id="aiMixPreview" controls hidden class="wide"></audio>
    <label id="aiChargeLabel" hidden><input id="aiCharge" type="checkbox"> Use my RoEx credits for this full master (250 credits at current provider pricing)</label>
    <button id="aiGetMaster" hidden>Get full mastered WAV</button>
    <a id="aiMasterLink" hidden class="button" target="_blank" rel="noopener">Download mastered WAV</a>
    <p class="hint">Keep the page open while processing. Download the result before its link expires. A failed request leaves your project unchanged.</p>`;
  document.querySelector(".sound").prepend(box);
  const $2 = (id) => document.getElementById(id);
  let taskId = "", working = false, resultId = 0;
  const say = (text) => {
    $2("aiMixStatus").textContent = text;
  };
  const run = async (fn) => {
    if (working) return;
    working = true;
    $2("startAiMix").disabled = $2("checkAiMix").disabled = $2("aiGetMaster").disabled = true;
    try {
      await fn();
    } catch (error) {
      say(
        error?.response?.data?.error || error.message || "AI request failed. Try again."
      );
    } finally {
      working = false;
      $2("startAiMix").disabled = $2("checkAiMix").disabled = $2("aiGetMaster").disabled = false;
    }
  };
  const request2 = async (data) => {
    const key = $2("roexKey").value.trim();
    if (!key)
      throw new Error("Open AI settings and paste your RoEx Tonn API key.");
    return (await api.post("/api/ai/audio", { ...data, key })).data;
  };
  const safeUrl = (value) => {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.hostname !== "storage.googleapis.com" || url.port || url.username || url.password)
      throw new Error("RoEx returned an unexpected file address.");
    return url.href;
  };
  const upload = async (blob) => {
    const urls = await request2({ action: "upload", consent: true });
    const response = await fetch(safeUrl(urls.signed_url), {
      method: "PUT",
      body: blob,
      headers: { "Content-Type": "audio/wav" },
      signal: AbortSignal.timeout(18e4)
    });
    if (!response.ok)
      throw new Error(
        "Audio upload failed. Check your connection and try again."
      );
    return safeUrl(urls.readable_url);
  };
  const check = async () => {
    if (!taskId) throw new Error("Create a mix first.");
    const state = await request2({ action: "status", taskId });
    if (state.status !== "complete") {
      say(
        "RoEx is processing your audio. Use Check current mix to check again."
      );
      return false;
    }
    const data = await request2({ action: "preview", taskId });
    $2("aiMixPreview").src = safeUrl(data.preview.preview_url);
    $2("aiMixPreview").hidden = false;
    $2("aiChargeLabel").hidden = $2("aiGetMaster").hidden = false;
    say(
      "Preview ready. Listen before using credits for the full master. Measured full-track loudness: " + Number(data.preview.measured_lufs_full).toFixed(1) + " LUFS."
    );
    return true;
  };
  $2("clearRoexKey").onclick = () => {
    $2("roexKey").value = "";
    say("API key cleared.");
  };
  $2("roexAccount").onclick = () => openExternal("https://tonn-portal.roexaudio.com/");
  $2("startAiMix").onclick = () => run(async () => {
    if (!$2("roexKey").value.trim())
      throw new Error("Enter your RoEx Tonn API key in AI settings first.");
    if (!$2("aiUploadConsent").checked)
      throw new Error("Confirm audio upload to RoEx before starting.");
    if (!window.ivPrepareAI)
      throw new Error("Studio is still loading. Try again.");
    const active = ++resultId;
    taskId = "";
    $2("aiMixPreview").pause();
    $2("aiMixPreview").hidden = $2("aiChargeLabel").hidden = $2("aiGetMaster").hidden = $2("aiMasterLink").hidden = true;
    $2("aiCharge").checked = false;
    say("Preparing vocals and beat on the same timeline\u2026");
    const files = await window.ivPrepareAI({
      tune: $2("aiTune").checked,
      detailed: $2("aiWorkflow").value === "grim"
    });
    say(files.summary + " Uploading vocals\u2026");
    const vocals = await upload(files.vocals);
    say("Uploading beat\u2026");
    const beat = await upload(files.beat);
    const created = await request2({
      action: "mix",
      consent: true,
      vocals,
      beat,
      style: $2("aiStyle").value,
      loudness: $2("aiLoudness").value,
      vocalGain: Number($2("aiVocalGain").value)
    });
    if (!created.recombineTaskId)
      throw new Error("RoEx returned no task ID. Try again.");
    taskId = created.recombineTaskId;
    $2("checkAiMix").hidden = false;
    say(
      "RoEx is mixing and mastering. You can keep working; this result uses the audio just uploaded."
    );
    for (let count = 0; count < 40 && active === resultId && !document.getElementById("studioShell").hidden; count++) {
      await new Promise((resolve) => setTimeout(resolve, 15e3));
      if (await check()) return;
    }
  });
  $2("checkAiMix").onclick = () => run(check);
  $2("aiGetMaster").onclick = () => run(async () => {
    if (!$2("aiCharge").checked)
      throw new Error("Confirm use of your RoEx credits first.");
    const data = await request2({
      action: "final",
      taskId,
      acceptCharge: true
    });
    const url = safeUrl(data.result.master_url);
    $2("aiMasterLink").href = url;
    $2("aiMasterLink").hidden = false;
    if (isDesktop)
      $2("aiMasterLink").onclick = (event) => {
        event.preventDefault();
        run(async () => {
          const response = await fetch(url);
          if (!response.ok)
            throw new Error(
              "The download link expired. Get the full master again."
            );
          const blob = await response.blob();
          const objectUrl = URL.createObjectURL(blob);
          const link = document.createElement("a");
          link.href = objectUrl;
          link.download = "Infected-Voices-master.wav";
          document.body.append(link);
          link.click();
          link.remove();
          setTimeout(() => URL.revokeObjectURL(objectUrl), 6e4);
        });
      };
    say(
      "Master ready. " + Number(data.result.measured_lufs).toFixed(1) + " LUFS. Download and keep a local copy."
    );
  });
  window.addEventListener("iv-locked", () => {
    resultId++;
    $2("aiMixPreview").pause();
    $2("roexKey").value = "";
  });
}

// browser-src/redx-api.js
var NATION_ORIGIN = typeof window !== "undefined" && window.__INFECTEDNATION_URL || "https://nation.infectedvoices.space";
var APP_ID = "infected-voices";
var TOKEN_KEY = "infectednation_session";
var me = { user: null };
var csrf = "";
var sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
var randomHex = (bytes) => {
  const value = crypto.getRandomValues(new Uint8Array(bytes));
  return [...value].map((v) => v.toString(16).padStart(2, "0")).join("");
};
async function jsonFetch(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2e4);
  try {
    const response = await fetch(url, { ...options, signal: options.signal || controller.signal });
    const text = await response.text();
    let data = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      throw Error("The server returned an unreadable response.");
    }
    if (!response.ok) {
      const error = Error(String(data.error || "Request failed.").slice(0, 600));
      error.status = response.status;
      error.code = data.code;
      throw error;
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}
async function nationPost(path, data) {
  return jsonFetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Accept": "application/json" },
    body: JSON.stringify(data || {}),
    credentials: "same-origin",
    redirect: "error"
  });
}
function token() {
  return localStorage.getItem(TOKEN_KEY) || "";
}
function setToken(value) {
  if (value) localStorage.setItem(TOKEN_KEY, value);
  else localStorage.removeItem(TOKEN_KEY);
}
async function connectNation(options = {}) {
  const flow = options.flow === "signup" ? "signup" : "login";
  const method = ["apple", "google", "android", "email"].includes(options.method) ? options.method : "email";
  const secret = randomHex(32);
  const request2 = await nationPost("/api/auth/connect/start", { appId: APP_ID, secret });
  if (typeof request2.id !== "string" || !Number.isFinite(request2.expires)) throw Error("InfectedNation returned an invalid connection request.");
  const url = NATION_ORIGIN + "/?connect=" + encodeURIComponent(request2.id) + "&app=" + encodeURIComponent(APP_ID) + "&flow=" + encodeURIComponent(flow) + "&method=" + encodeURIComponent(method);
  const popup = window.open(url, "infectednation-login", "popup,width=560,height=780");
  if (!popup) {
    const error = Error("Allow popups for infectedvoices.space, then try again.");
    error.code = "popup_blocked";
    throw error;
  }
  while (Date.now() < request2.expires) {
    await sleep(1400);
    const result = await nationPost("/api/auth/connect/session", { id: request2.id, secret });
    if (result.pending) continue;
    if (!result.token || !result.account) throw Error("InfectedNation returned an incomplete session.");
    setToken(result.token);
    try {
      popup.close();
    } catch {
    }
    return result.account;
  }
  try {
    popup.close();
  } catch {
  }
  throw Error("InfectedNation sign-in expired. Start again.");
}
async function request(path, body, options = {}) {
  const method = options.method || (body === void 0 ? "GET" : "POST");
  const headers = { "Accept": "application/json", ...options.headers };
  const current = token();
  if (current) headers.Authorization = "Bearer " + current;
  if (body !== void 0 && !options.binary) headers["Content-Type"] = "application/json";
  const response = await fetch(path, {
    method,
    credentials: "same-origin",
    headers,
    body: body === void 0 ? void 0 : options.binary ? body : JSON.stringify(body),
    signal: options.signal || AbortSignal.timeout(options.binary ? 12e4 : 2e4)
  });
  if (options.bytes && response.ok) return response.arrayBuffer();
  let data;
  try {
    data = await response.json();
  } catch {
    throw Error("The RedXAIHost Studio service returned an unreadable response.");
  }
  if (!response.ok) {
    const error = Error(data.error || "Request failed.");
    error.status = response.status;
    error.code = data.code;
    throw error;
  }
  return data;
}
async function session() {
  me = await request("/api/me");
  csrf = me.csrf || "";
  return me;
}
var api2 = {
  async get(path) {
    return { data: await request(path) };
  },
  async post(path, body) {
    return { data: await request(path, body) };
  },
  async put(path, body) {
    return { data: await request(path, body, { method: "PUT" }) };
  },
  async delete(path) {
    return { data: await request(path, {}, { method: "DELETE" }) };
  }
};
var auth2 = {
  async getUser() {
    const s = await session();
    return s.user ? { ...s.user, userId: s.user.id } : null;
  },
  isSignedIn: () => !!me.user,
  async signIn(options = {}) {
    const requested = options?.method ? options : JSON.parse(sessionStorage.getItem("iv-auth-request") || "{}");
    sessionStorage.removeItem("iv-auth-request");
    await connectNation(requested);
    const s = await session();
    return { user: s.user };
  },
  async emailLogin(opts) {
    return emailLogin(opts);
  },
  async emailSignup(fields) {
    return emailSignup(fields);
  },
  async signOut() {
    const current = token();
    try {
      if (current) await request("/api/logout", {});
    } finally {
      setToken("");
      me = { user: null };
      csrf = "";
    }
  }
};
async function emailLogin({ login, password, totpCode }) {
  const body = { appId: APP_ID, email: login, username: login, login, password };
  if (totpCode) body.totpCode = totpCode;
  const data = await nationPost("/api/auth/login/email", body);
  if (!data.token) throw Error(data.error || "Login failed");
  setToken(data.token);
  return data.account || data;
}
async function emailSignup(fields) {
  const data = await nationPost("/api/auth/signup/email", { ...fields, appId: APP_ID });
  if (!data.token) throw Error(data.error || "Signup failed");
  setToken(data.token);
  return data.account || data;
}

// app-source/classic-source/account.js
var $ = (id) => document.getElementById(id);
var loaded = false;
var checking = false;
var cursor = "";
var codes = [];
var message = (text) => {
  $("accountStatus").textContent = text;
};
function detectLabMode() {
  const ua = navigator.userAgent.toLowerCase();
  if (/iphone|ipad|ipod/.test(ua) || navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
    return "ios";
  if (/android/.test(ua)) return "android";
  return "pc";
}
function setLabMode(mode) {
  const valid = ["auto", "ios", "android", "pc"], wanted = valid.includes(mode) ? mode : "auto", effective = wanted === "auto" ? detectLabMode() : wanted;
  localStorage.setItem("iv-device-mode", wanted);
  document.body.dataset.deviceMode = effective;
  $("labDeviceStatus").textContent = wanted === "auto" ? "Auto \u2192 " + effective.toUpperCase() : wanted.toUpperCase() + " layout forced.";
}
function setupLabChrome() {
  setLabMode(localStorage.getItem("iv-device-mode") || "auto");
  $("labWrench").onclick = () => {
    $("labDeviceMenu").hidden = !$("labDeviceMenu").hidden;
  };
  document.querySelectorAll("[data-lab-mode]").forEach(
    (button) => button.onclick = () => {
      setLabMode(button.dataset.labMode);
      $("labDeviceMenu").hidden = true;
    }
  );
}
function ensureCoach() {
  if ($("aiCoach") || !document.querySelector(".sound")) return;
  const box = document.createElement("div");
  box.className = "mixbox";
  box.innerHTML = '<h3>AI Vocal Coach</h3><p>Ask for tuning, timing, delivery or mix suggestions using the project settings shown in Studio. This coach does not upload or listen to your recording.</p><textarea id="aiGoal" maxlength="600" placeholder="Example: Keep this 150 BPM G minor verse aggressive but make the vocal sit cleaner over the dubstep drop."></textarea><button id="aiCoach" class="primary wide">Ask AI Vocal Coach</button><p id="aiCoachResult" aria-live="polite"></p>';
  document.querySelector(".sound").prepend(box);
  $("aiCoach").onclick = () => task(async () => {
    const goal = $("aiGoal").value.trim();
    if (!goal) throw new Error("Tell the AI coach what you want help with.");
    $("aiCoachResult").textContent = "Thinking\u2026";
    const { data } = await api2.post("/api/ai/coach", {
      goal,
      bpm: Number($("bpm")?.value || 150),
      root: $("root")?.value || "",
      scale: $("scale")?.value || "",
      timingProfile: $("pocketProfile")?.value || "",
      masterProfile: $("masterProfile")?.value || "",
      strength: Number($("strength")?.value || 0),
      maxMove: Number($("maxMove")?.value || 0)
    });
    $("aiCoachResult").textContent = data.text;
  });
}
async function task(fn) {
  try {
    await fn();
  } catch (e) {
    message(
      e?.response?.data?.error || e?.message || "Request failed. Try again."
    );
  }
}
async function lock() {
  window.dispatchEvent(new Event("iv-locked"));
  if (loaded) {
    await window.ivShutdown?.();
    $("recovery").hidden = false;
  }
  $("studioShell").hidden = true;
}
async function refresh() {
  if (checking) return;
  checking = true;
  try {
    const user = await auth2.getUser();
    window.ivUserId = user?.userId || "";
    document.body.classList.toggle("auth-pending", !user);
    $("labLoginWall").hidden = !!user;
    $("account").hidden = !user;
    $("signIn").hidden = !!user;
    $("signupNote").hidden = !!user;
    $("signOut").hidden = !user;
    $("refreshAccess").hidden = !user;
    $("membership").hidden = !user;
    if (!user) {
      await lock();
      $("ownerPanel").hidden = true;
      message("Sign in to open your vocal lab.");
      return;
    }
    const { data } = await api2.get("/api/access");
    $("ownerPanel").hidden = !data.owner;
    $("subscribe").hidden = !!data.allowed;
    $("billing").hidden = true;
    $("subscribe").disabled = !!data.allowed;
    $("billing").disabled = true;
    message(
      data.email + " \xB7 " + (data.allowed ? data.kind + " access" : data.kind === "banned" ? "Account banned" : "Access needed") + " \xB7 RedXAIHost account"
    );
    if (data.allowed) {
      const walkthrough = await api2.get("/api/onboarding");
      if (!walkthrough.data.complete) {
        await lock();
        location.href = "../studio.html";
        return;
      }
      $("studioShell").hidden = false;
      if (!loaded) {
        await import(
          /* @vite-ignore */
          new URL("./studio-runtime.js", location.href).href
        );
        loaded = true;
      }
      $("recovery").hidden = true;
      ensureCoach();
      mountMixer();
      if (!window.ivClassicHelpRequested) {
        window.ivClassicHelpRequested = true;
        const helpUrl = new URL("../workstation/classic-help.js", location.href);
        import(
          /* @vite-ignore */
          helpUrl.href
        ).then((module) => module.mountClassicHelp()).catch(() => {
          window.ivClassicHelpRequested = false;
          message("Studio is open. Setting explanations could not load; refresh access to retry.");
        });
      }
      if (!$("arrangementStudioLink")) {
        const link = document.createElement("a");
        link.id = "arrangementStudioLink";
        link.className = "button";
        link.textContent = "Arrangement Studio & detailed tutorial";
        link.href = "../studio.html#tutorial";
        $("account").append(link);
      }
      if (data.owner && !codes.length) {
        try {
          await listCodes(false);
        } catch {
          message(
            data.email + " \xB7 owner access \xB7 Artist codes could not load. Use Refresh codes to retry."
          );
        }
      }
    } else await lock();
  } catch (e) {
    await lock();
    throw e;
  } finally {
    checking = false;
  }
}
async function doSignIn() {
  try {
    await auth2.signIn();
    $("labLoginStatus").textContent = "";
    await refresh();
  } catch (e) {
    const text = e.code === "popup_blocked" ? "Allow popups for this site, then try Google sign-in again." : e.code === "popup_closed" ? "Sign-in was closed. You can try again." : e.message || "Sign-in failed.";
    $("labLoginStatus").textContent = text;
    throw new Error(text);
  }
}
$("signIn").onclick = () => task(doSignIn);
$("labSignInHero").onclick = () => task(doSignIn);
$("signOut").onclick = () => task(async () => {
  await lock();
  await auth2.signOut();
  location.reload();
});
$("refreshAccess").onclick = () => task(refresh);
$("recovery").onclick = () => task(() => window.ivRecovery?.());
$("redeem").onclick = () => task(async () => {
  const code = $("redeemCode").value.trim();
  if (!code) throw new Error("Enter a FogSpit code first.");
  await api2.post("/api/redeem", { code });
  $("redeemCode").value = "";
  await refresh();
});
$("subscribe").onclick = () => message("Purchases are not offered inside the iOS build.");
$("billing").onclick = () => message("Billing links are not offered inside the iOS build.");
function renderCodes() {
  $("ownerCodes").replaceChildren();
  for (const code of codes) {
    const row = document.createElement("div");
    row.className = "license";
    const name = document.createElement("strong");
    name.textContent = code.artist + (code.revoked ? " \xB7 REVOKED" : " \xB7 Lifetime");
    const email = document.createElement("small");
    email.textContent = code.email;
    const text = document.createElement("code");
    text.textContent = code.code;
    const copy = document.createElement("button");
    copy.textContent = "Copy code";
    copy.onclick = () => task(async () => {
      await navigator.clipboard.writeText(code.code);
      message("Code copied for " + code.artist);
    });
    row.append(name, email, text, copy);
    if (!code.revoked) {
      const revoke = document.createElement("button");
      revoke.textContent = "Revoke free access";
      revoke.onclick = () => task(async () => {
        if (!confirm(
          "Revoke free access for " + code.artist + "? This cannot be undone; you can issue a new code later."
        ))
          return;
        await api2.post(
          "/api/owner/codes/" + encodeURIComponent(code.id) + "/revoke",
          {}
        );
        code.revoked = true;
        renderCodes();
        message("Free access revoked for " + code.artist);
      });
      row.append(revoke);
    }
    $("ownerCodes").append(row);
  }
  $("moreCodes").hidden = !cursor;
}
async function listCodes(more) {
  const { data } = await api2.get(
    "/api/owner/codes" + (more && cursor ? "?cursor=" + encodeURIComponent(cursor) : "")
  );
  codes = more ? [...codes, ...data.items] : data.items;
  cursor = data.nextToken || "";
  renderCodes();
}
$("generateCode").onclick = () => task(async () => {
  const artist = $("artistName").value.trim(), email = $("artistEmail").value.trim();
  if (!artist || !$("artistEmail").checkValidity() || !email) throw new Error("Enter the artist name and a valid email.");
  const { data } = await api2.post("/api/owner/codes", { artist, email });
  codes.unshift(data);
  renderCodes();
  message("Code generated and saved for " + artist + ".");
  $("artistName").value = "";
  $("artistEmail").value = "";
});
$("refreshCodes").onclick = () => task(() => listCodes(false));
$("moreCodes").onclick = () => task(() => listCodes(true));
setInterval(() => {
  if (auth2.isSignedIn()) task(refresh);
}, 6e4);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) task(refresh);
});
setupLabChrome();
task(refresh);
var moderation = document.createElement("section");
moderation.className = "panel";
moderation.hidden = true;
$("ownerPanel").append(moderation);
moderation.innerHTML = `<h2>Studio members</h2><p>Registered on first studio visit. Activity contains recent browser control requests, not recordings or proof of completed actions. The rebuilt Windows app reports the same action labels as the browser. Older v0.3.0 activity is unavailable. Connection IP may be a proxy; country and state are unavailable until a trusted location service is configured.</p><label>Search name, email or connection IP<input id="memberQuery" maxlength="254" type="search"></label><div class="transport"><button id="memberSearch">Search / refresh</button><button id="memberOlder" hidden>Load next search batch</button></div><p id="memberStatus" role="status"></p><div id="memberRows"></div><div class="transport"><button id="memberPrev">\u2190 Previous</button><span id="memberPage"></span><button id="memberNext">Next \u2192</button></div><div id="memberInspect" hidden></div>`;
var members = [];
var memberPage = 0;
var memberCursor = "";
var memberBusy = false;
var node = (tag, text) => {
  const n = document.createElement(tag);
  n.textContent = text;
  return n;
};
async function memberTask(fn) {
  if (memberBusy) return;
  memberBusy = true;
  try {
    await fn();
  } catch (e) {
    $("memberStatus").textContent = e?.response?.data?.error || e.message || "Request failed";
  } finally {
    memberBusy = false;
  }
}
function drawMembers() {
  $("memberRows").replaceChildren();
  for (const v of members.slice(memberPage * 10, memberPage * 10 + 10)) {
    const row = node("div", "");
    row.className = "license";
    row.append(
      node("strong", v.name || v.email),
      node(
        "p",
        `${v.email} \xB7 ${v.ip || "IP unavailable"} \xB7 ${v.country} / ${v.region}`
      ),
      node("small", "Registered " + new Date(v.created).toLocaleString())
    );
    const inspect = node("button", "Inspect");
    inspect.onclick = () => {
      location.hash = "member/" + encodeURIComponent(v.id);
    };
    const ban = node("button", "Ban");
    ban.onclick = () => memberTask(async () => {
      if (!confirm(
        "Ban " + v.email + "? This blocks studio access but does not cancel their subscription."
      ))
        return;
      await api2.post(
        "/api/owner/users/" + encodeURIComponent(v.id) + "/ban",
        { active: true }
      );
      $("memberStatus").textContent = "Banned " + v.email;
    });
    row.append(inspect, ban);
    $("memberRows").append(row);
  }
  $("memberPage").textContent = `Page ${memberPage + 1} of ${Math.max(1, Math.ceil(members.length / 10))}`;
  $("memberPrev").disabled = memberPage === 0;
  $("memberNext").disabled = (memberPage + 1) * 10 >= members.length;
}
async function getMembers(next = false) {
  const { data } = await api2.get(
    "/api/owner/users?q=" + encodeURIComponent($("memberQuery").value) + (next ? "&cursor=" + encodeURIComponent(memberCursor) : "")
  );
  members = data.items;
  memberCursor = data.nextToken;
  memberPage = 0;
  $("memberOlder").hidden = !memberCursor;
  $("memberStatus").textContent = data.coverage;
  drawMembers();
}
async function memberRoute() {
  const match = location.hash.match(/^#member\/([^/]+)$/);
  $("memberInspect").hidden = !match;
  $("memberRows").hidden = !!match;
  if (!match) return;
  const { data: v } = await api2.get(
    "/api/owner/users/" + encodeURIComponent(decodeURIComponent(match[1]))
  );
  const box = $("memberInspect");
  box.replaceChildren();
  const back = node("a", "\u2190 Back to members");
  back.href = "#members";
  box.append(
    back,
    node("h2", v.name || v.email),
    node("p", v.email + " \xB7 " + (v.banned ? "Banned" : "Not banned")),
    node(
      "p",
      "Connection IP: " + (v.ip || "Unavailable") + " \xB7 " + v.country + " / " + v.region
    )
  );
  const toggle = node("button", v.banned ? "Unban" : "Ban");
  toggle.onclick = () => memberTask(async () => {
    if (!confirm(
      (v.banned ? "Unban " : "Ban ") + v.email + "? Subscriptions are managed separately."
    ))
      return;
    await api2.post("/api/owner/users/" + encodeURIComponent(v.id) + "/ban", {
      active: !v.banned
    });
    await memberRoute();
  });
  box.append(toggle);
  box.append(node("h3", "Recent browser actions (up to 100)"));
  if (!v.events.length)
    box.append(
      node(
        "p",
        "No activity recorded yet. Older activity and Windows activity are unavailable."
      )
    );
  for (const event of v.events)
    box.append(
      node(
        "p",
        new Date(event.at).toLocaleString() + " \xB7 " + event.action + " requested"
      )
    );
}
$("memberSearch").onclick = () => memberTask(() => getMembers());
$("memberOlder").onclick = () => memberTask(() => getMembers(true));
$("memberQuery").onkeydown = (e) => {
  if (e.key === "Enter") memberTask(() => getMembers());
};
$("memberPrev").onclick = () => {
  memberPage--;
  drawMembers();
};
$("memberNext").onclick = () => {
  memberPage++;
  drawMembers();
};
window.addEventListener("hashchange", () => {
  if (!moderation.hidden) memberTask(memberRoute);
});
var ownerWasVisible = false;
var watchOwner = new MutationObserver(() => {
  const visible = !$("ownerPanel").hidden;
  if (visible === ownerWasVisible) return;
  ownerWasVisible = visible;
  moderation.hidden = !visible;
  if (!moderation.hidden) memberTask(async () => {
    await getMembers();
    await memberRoute();
  });
  else {
    members = [];
    $("memberRows").replaceChildren();
    $("memberInspect").replaceChildren();
  }
});
watchOwner.observe($("ownerPanel"), {
  attributes: true,
  attributeFilter: ["hidden"]
});
var lastActivity = 0;
var actions = /* @__PURE__ */ new Set([
  "record",
  "play",
  "mic",
  "align",
  "applyAlign",
  "master",
  "export",
  "save",
  "load",
  "backup",
  "openProject",
  "beatFile",
  "vocalFile",
  "previewMix"
]);
document.addEventListener("click", (e) => {
  const id = e.target.closest("button")?.id;
  if (!actions.has(id) || $("studioShell").hidden || Date.now() - lastActivity < 2e3) return;
  lastActivity = Date.now();
  api2.post("/api/activity", { action: id }).catch(() => {
  });
});
window.addEventListener("iv-auth-status", (event) => {
  $("labLoginStatus").textContent = event.detail;
  message(event.detail);
});
