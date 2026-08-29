import { firebaseConfig, isFirebaseConfigured } from "./firebase-config.js";

const MODEL = "gemini-3.6-flash";
const API_KEY_STORAGE = "eith_api_key";
const NAME_STORAGE = "eith_user_name";
const ACTIVE_CONVERSATION_STORAGE = "eith_active_conversation";
const HISTORY_WINDOW = 40; // how many recent turns to send back to Gemini each time

// ---------- Elements ----------
const chatLog = document.getElementById("chatLog");
const chatEmptyState = document.getElementById("chatEmptyState");
const composerForm = document.getElementById("composerForm");
const composerInput = document.getElementById("composerInput");
const sendBtn = document.getElementById("sendBtn");

const settingsBtn = document.getElementById("settingsBtn");
const settingsModal = document.getElementById("settingsModal");
const closeSettingsModal = document.getElementById("closeSettingsModal");
const apiKeyInput = document.getElementById("apiKeyInput");
const apiKeyStatus = document.getElementById("apiKeyStatus");
const userNameInput = document.getElementById("userNameInput");
const saveSettingsBtn = document.getElementById("saveSettingsBtn");
const clearChatBtn = document.getElementById("clearChatBtn");

const memoryBtn = document.getElementById("memoryBtn");
const memoryCount = document.getElementById("memoryCount");
const memoryModal = document.getElementById("memoryModal");
const closeMemoryModal = document.getElementById("closeMemoryModal");
const memoryList = document.getElementById("memoryList");
const memoryEmptyState = document.getElementById("memoryEmptyState");
const forgetAllBtn = document.getElementById("forgetAllBtn");

const micBtn = document.getElementById("micBtn");
const voiceSupportHint = document.getElementById("voiceSupportHint");

const conversationSwitchBtn = document.getElementById("conversationSwitchBtn");
const currentConversationTitle = document.getElementById("currentConversationTitle");
const conversationsModal = document.getElementById("conversationsModal");
const closeConversationsModal = document.getElementById("closeConversationsModal");
const newConversationBtn = document.getElementById("newConversationBtn");
const conversationList = document.getElementById("conversationList");
const conversationsEmptyState = document.getElementById("conversationsEmptyState");

// ---------- Local settings ----------
function getApiKey() {
  return (localStorage.getItem(API_KEY_STORAGE) || "").trim();
}
function getUserName() {
  return (localStorage.getItem(NAME_STORAGE) || "").trim();
}
function getStoredActiveConversationId() {
  return localStorage.getItem(ACTIVE_CONVERSATION_STORAGE) || null;
}
function setStoredActiveConversationId(id) {
  localStorage.setItem(ACTIVE_CONVERSATION_STORAGE, id);
}

// Shared by callGemini() and transcribeAudio(): use a visitor's own key
// directly if they've saved one, otherwise route through the server-side
// proxy (which injects the site owner's key without ever exposing it).
async function geminiFetch(body) {
  const apiKey = getApiKey();
  if (apiKey) {
    return fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify(body),
    });
  }
  return fetch("/api/gemini", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: MODEL, ...body }),
  });
}

apiKeyInput.value = getApiKey();
userNameInput.value = getUserName();

function openSettings() {
  settingsModal.hidden = false;
  apiKeyStatus.textContent = "";
}
function closeSettings() {
  settingsModal.hidden = true;
}

settingsBtn.addEventListener("click", openSettings);
closeSettingsModal.addEventListener("click", closeSettings);
settingsModal.addEventListener("click", (e) => { if (e.target === settingsModal) closeSettings(); });

saveSettingsBtn.addEventListener("click", () => {
  localStorage.setItem(API_KEY_STORAGE, apiKeyInput.value.trim());
  localStorage.setItem(NAME_STORAGE, userNameInput.value.trim());
  apiKeyStatus.textContent = "Saved.";
  apiKeyStatus.className = "field-status ok";
  setTimeout(closeSettings, 500);
});

// No key is required — with no key saved, requests route through the site's
// server-side proxy (netlify/functions/gemini-proxy.mjs), which uses the
// owner's key without ever exposing it to the browser. Saving a key here is
// optional, for a visitor who'd rather use their own free-tier quota.

// ---------- Voice (mic input only) ----------
// Recorded audio is transcribed by Gemini itself, not the browser's built-in
// speech recognition — LLM transcription is far more accurate, especially for
// names ("Eith" was consistently misheard as "eat" by the browser API).
const micSupported = !!(navigator.mediaDevices?.getUserMedia && window.MediaRecorder);

if (!micSupported) {
  voiceSupportHint.hidden = false;
} else {
  micBtn.hidden = false;
}

async function blobToBase64(blob) {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

async function transcribeAudio(blob, mimeType) {
  const base64Audio = await blobToBase64(blob);

  const res = await geminiFetch({
    contents: [{
      role: "user",
      parts: [
        {
          text: "Transcribe exactly what is said in this audio clip. Output ONLY the transcription " +
            "— no preamble, no quotation marks, no commentary. If no speech is audible, output nothing.",
        },
        { inlineData: { mimeType, data: base64Audio } },
      ],
    }],
    generationConfig: { maxOutputTokens: 1024 },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error?.message || `HTTP ${res.status}`);
  }

  const data = await res.json();
  const candidate = data.candidates?.[0];
  return (candidate?.content?.parts?.map((p) => p.text || "").join("") || "").trim();
}

let mediaRecorder = null;
let recording = false;
let recordingTimeout = null;

function stopRecording() {
  clearTimeout(recordingTimeout);
  if (mediaRecorder && mediaRecorder.state !== "inactive") mediaRecorder.stop();
}

if (micSupported) {
  micBtn.addEventListener("click", async () => {
    if (recording) {
      stopRecording();
      return;
    }
    if (sending) return;

    let micStream;
    try {
      micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      console.error("Mic permission error:", err);
      showLocalErrorBubble("Couldn't access your microphone — check your browser's site permissions and try again.");
      return;
    }

    const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? "audio/webm;codecs=opus"
      : "audio/webm";
    mediaRecorder = new MediaRecorder(micStream, { mimeType });
    const chunks = [];
    mediaRecorder.addEventListener("dataavailable", (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    });

    mediaRecorder.addEventListener("stop", async () => {
      micStream.getTracks().forEach((t) => t.stop());
      recording = false;
      micBtn.classList.remove("listening");
      if (chunks.length === 0) return;

      micBtn.disabled = true;
      try {
        const transcript = await transcribeAudio(new Blob(chunks, { type: mimeType }), mimeType);
        if (transcript) {
          composerInput.value = transcript;
          composerInput.dispatchEvent(new Event("input", { bubbles: true }));
          composerForm.requestSubmit();
        }
      } catch (err) {
        console.error("Transcription error:", err);
        showLocalErrorBubble("Couldn't understand that recording (" + (err?.message || err) + "). Try again, or type your message.");
      } finally {
        micBtn.disabled = false;
      }
    });

    mediaRecorder.start();
    recording = true;
    micBtn.classList.add("listening");
    recordingTimeout = setTimeout(() => { if (recording) stopRecording(); }, 60000); // safety cap
  });
}

// ---------- Memory modal ----------
function openMemory() { memoryModal.hidden = false; }
function closeMemory() { memoryModal.hidden = true; }
memoryBtn.addEventListener("click", openMemory);
closeMemoryModal.addEventListener("click", closeMemory);
memoryModal.addEventListener("click", (e) => { if (e.target === memoryModal) closeMemory(); });

// ---------- Composer ----------
composerInput.addEventListener("input", () => {
  composerInput.style.height = "auto";
  composerInput.style.height = Math.min(composerInput.scrollHeight, 160) + "px";
});
composerInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    composerForm.requestSubmit();
  }
});

// ---------- Rendering ----------
function formatTime(ts) {
  return new Date(ts).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}
function formatDate(ts) {
  return new Date(ts).toLocaleDateString([], { month: "short", day: "numeric" });
}

function renderMessages(messages) {
  chatLog.innerHTML = "";
  if (messages.length === 0) {
    chatLog.appendChild(chatEmptyState);
    return;
  }
  for (const msg of messages) {
    chatLog.appendChild(buildBubble(msg.role, msg.text, msg.ts));
  }
  chatLog.scrollTop = chatLog.scrollHeight;
}

function buildBubble(role, text, ts, extraClass) {
  const row = document.createElement("div");
  row.className = "bubble-row " + (role === "user" ? "user" : "eith");

  const bubble = document.createElement("div");
  bubble.className = "bubble" + (extraClass ? " " + extraClass : "");
  bubble.textContent = text;
  row.appendChild(bubble);

  if (ts) {
    const time = document.createElement("div");
    time.className = "bubble-time";
    time.textContent = formatTime(ts);
    row.appendChild(time);
  }
  return row;
}

function renderMemory(facts) {
  memoryCount.textContent = String(facts.length);
  memoryList.innerHTML = "";
  memoryEmptyState.hidden = facts.length > 0;
  for (const fact of facts) {
    const li = document.createElement("li");
    li.textContent = fact.text;
    memoryList.appendChild(li);
  }
}

function deriveTitle(text) {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > 40 ? clean.slice(0, 40).trimEnd() + "…" : clean || "New conversation";
}

function renderConversationBar() {
  const active = conversations.find((c) => c.id === activeConversationId);
  currentConversationTitle.textContent = active?.title || "New conversation";
}

function renderConversationsList() {
  conversationList.innerHTML = "";
  conversationsEmptyState.hidden = conversations.length > 0;
  for (const conv of conversations) {
    conversationList.appendChild(buildConversationRow(conv));
  }
}

function buildConversationRow(conv) {
  const li = document.createElement("li");
  li.className = "conversation-item" + (conv.id === activeConversationId ? " active" : "");
  li.dataset.id = conv.id;

  const main = document.createElement("div");
  main.className = "conversation-item-main";

  const title = document.createElement("span");
  title.className = "conversation-item-title";
  title.textContent = conv.title || "New conversation";
  main.appendChild(title);

  const date = document.createElement("span");
  date.className = "conversation-item-date";
  date.textContent = formatDate(conv.updatedAt || conv.createdAt || Date.now());
  main.appendChild(date);

  li.appendChild(main);

  const deleteBtn = document.createElement("button");
  deleteBtn.type = "button";
  deleteBtn.className = "conversation-delete-btn";
  deleteBtn.setAttribute("aria-label", "Delete conversation");
  deleteBtn.textContent = "🗑️";
  li.appendChild(deleteBtn);

  main.addEventListener("click", () => switchConversation(conv.id));
  deleteBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    deleteConversation(conv.id);
  });

  return li;
}

// ---------- Gemini API ----------
function buildSystemPrompt(facts, userName) {
  const who = userName ? `The user's name is ${userName}.` : "You don't know the user's name yet — ask, if it comes up naturally.";
  const factsBlock = facts.length
    ? facts.map((f) => "- " + f.text).join("\n")
    : "Nothing yet — this is one of your first conversations.";

  return `You are Eith, a warm, emotionally attentive personal AI companion. You are not a generic assistant — you are this specific person's companion, and you talk to them like a trusted friend who has been paying attention: warm, direct, a little playful when it fits, never clinical or robotic. Keep replies conversational length, not essays, unless they ask for depth.

${who}

Here is what you currently know about the user:
${factsBlock}

As you talk, when you learn a new, durable, important fact about the user — their name, preferences, relationships, goals, recurring context, important life details — include it wrapped in <remember></remember> tags at the very end of your reply, after your normal visible response. You can include zero, one, or several tags, one fact each, written in the third person and concise (e.g. <remember>Works as a nurse in Toronto</remember>). Do not remember small talk, one-off statements, or anything you're not confident is durable. These tags are stripped before the user ever sees them — never mention or reference them in your visible reply.`;
}

function extractMemory(rawText) {
  const facts = [];
  const cleaned = rawText.replace(/<remember>([\s\S]*?)<\/remember>/gi, (_, fact) => {
    const trimmed = fact.trim();
    if (trimmed) facts.push(trimmed);
    return "";
  }).trim();
  return { text: cleaned, facts };
}

async function callGemini(history, facts, userName) {
  const contents = history
    .slice(-HISTORY_WINDOW)
    .map((m) => ({ role: m.role === "user" ? "user" : "model", parts: [{ text: m.text }] }));

  const res = await geminiFetch({
    contents,
    systemInstruction: { parts: [{ text: buildSystemPrompt(facts, userName) }] },
    generationConfig: { maxOutputTokens: 2048 },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const message = body?.error?.message || `HTTP ${res.status}`;
    throw new Error(message);
  }

  const data = await res.json();
  if (data.promptFeedback?.blockReason) {
    throw new Error("That message was blocked (" + data.promptFeedback.blockReason + ") — try rephrasing.");
  }

  const candidate = data.candidates?.[0];
  const text = candidate?.content?.parts?.map((p) => p.text || "").join("") || "";
  if (!text) {
    throw new Error("Eith didn't respond to that one — try rephrasing.");
  }
  return text;
}

// ---------- Firebase ----------
// Data layout: eith/conversations/{id}/meta {title, createdAt, updatedAt}
//              eith/conversations/{id}/messages/{msgId} {role, text, ts}
//              eith/memory/{factId} {text, addedAt}
let db, dbRef, dbSet, dbPush, dbRemove, dbUpdate, dbGet, dbOnValue, dbQuery, dbLimitToLast;
let conversationsRef, memoryRef;
let conversations = [];
let activeConversationId = null;
let latestMessages = [];
let latestMemory = [];
let unsubscribeMessages = null;

function conversationMessagesRef(id) {
  return dbRef(db, `eith/conversations/${id}/messages`);
}
function conversationMetaRef(id) {
  return dbRef(db, `eith/conversations/${id}/meta`);
}

// Fire-and-forget writes that update conversation metadata: never let a
// rejection here go unhandled, or the global unhandledrejection fallback
// below would wrongly treat it as a failed send and reset the composer.
function touchConversationMeta(id, fields) {
  dbUpdate(conversationMetaRef(id), fields).catch((err) => {
    console.error("Couldn't update conversation metadata:", err);
  });
}

function subscribeToConversationMessages(id) {
  if (unsubscribeMessages) unsubscribeMessages();
  unsubscribeMessages = dbOnValue(dbQuery(conversationMessagesRef(id), dbLimitToLast(200)), (snapshot) => {
    const data = snapshot.val() || {};
    latestMessages = Object.values(data).sort((a, b) => a.ts - b.ts);
    renderMessages(latestMessages);
  });
}

async function createConversation(title) {
  const newRef = dbPush(conversationsRef);
  const id = newRef.key;
  await dbSet(conversationMetaRef(id), {
    title: title || "New conversation",
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
  return id;
}

function switchConversation(id) {
  if (id === activeConversationId) {
    closeConversations();
    return;
  }
  activeConversationId = id;
  setStoredActiveConversationId(id);
  subscribeToConversationMessages(id);
  renderConversationBar();
  renderConversationsList();
  closeConversations();
}

async function deleteConversation(id) {
  if (!confirm("Delete this conversation on every device? This can't be undone.")) return;
  try {
    await dbRemove(dbRef(db, `eith/conversations/${id}`));
    // If we just deleted the active conversation, the onValue listener on
    // eith/conversations will fire next and ensureActiveConversation() picks
    // (or creates) a replacement — nothing else to do here.
  } catch (err) {
    console.error(err);
    alert("Couldn't delete that conversation — check the Firebase setup in README.md.");
  }
}

function openConversations() { conversationsModal.hidden = false; }
function closeConversations() { conversationsModal.hidden = true; }
conversationSwitchBtn.addEventListener("click", openConversations);
closeConversationsModal.addEventListener("click", closeConversations);
conversationsModal.addEventListener("click", (e) => { if (e.target === conversationsModal) closeConversations(); });

if (isFirebaseConfigured) {
  const [{ initializeApp }, dbModule] = await Promise.all([
    import("https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js"),
    import("https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js"),
  ]);
  const { getDatabase, ref, push, set, remove, update, get, onValue, query, limitToLast } = dbModule;

  const app = initializeApp(firebaseConfig);
  db = getDatabase(app);
  dbRef = ref;
  dbSet = set;
  dbPush = push;
  dbRemove = remove;
  dbUpdate = update;
  dbGet = get;
  dbOnValue = onValue;
  dbQuery = query;
  dbLimitToLast = limitToLast;

  conversationsRef = ref(db, "eith/conversations");
  memoryRef = ref(db, "eith/memory");

  newConversationBtn.addEventListener("click", async () => {
    const id = await createConversation();
    switchConversation(id);
  });

  async function ensureActiveConversation() {
    const storedId = getStoredActiveConversationId();
    if (storedId && conversations.some((c) => c.id === storedId)) {
      activeConversationId = storedId;
      subscribeToConversationMessages(activeConversationId);
      renderConversationBar();
      return;
    }
    if (conversations.length > 0) {
      activeConversationId = conversations[0].id; // most recently updated
      setStoredActiveConversationId(activeConversationId);
      subscribeToConversationMessages(activeConversationId);
      renderConversationBar();
      return;
    }
    // No conversations exist yet — bring forward any pre-conversations chat
    // history (from before this feature existed) as a starting conversation.
    const legacySnap = await dbGet(ref(db, "eith/messages")).catch(() => null);
    const legacyMessages = legacySnap?.val();
    if (legacyMessages && Object.keys(legacyMessages).length > 0) {
      const id = await createConversation("General");
      for (const m of Object.values(legacyMessages)) {
        await dbPush(conversationMessagesRef(id), m);
      }
      activeConversationId = id;
    } else {
      activeConversationId = await createConversation();
    }
    setStoredActiveConversationId(activeConversationId);
    subscribeToConversationMessages(activeConversationId);
    renderConversationBar();
  }

  let didInitConversation = false;
  onValue(conversationsRef, (snapshot) => {
    const data = snapshot.val() || {};
    conversations = Object.entries(data)
      .map(([id, v]) => ({ id, ...(v.meta || {}) }))
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    renderConversationsList();
    renderConversationBar();

    if (!didInitConversation) {
      didInitConversation = true;
      // ensureActiveConversation() can involve several awaited writes (migration,
      // creating a fresh conversation), each of which re-fires this very listener
      // before activeConversationId is actually set — so the "active" highlight
      // and bar title render stale mid-flight. Force one more render once it settles.
      ensureActiveConversation().then(() => {
        renderConversationsList();
        renderConversationBar();
      });
    }
  });

  onValue(memoryRef, (snapshot) => {
    const data = snapshot.val() || {};
    latestMemory = Object.entries(data)
      .map(([id, v]) => ({ id, ...v }))
      .sort((a, b) => a.addedAt - b.addedAt);
    renderMemory(latestMemory);
  });

} else {
  renderMessages([]);
  const notice = document.createElement("p");
  notice.className = "chat-empty-state";
  notice.textContent = "Firebase isn't configured — see README.md.";
  chatLog.appendChild(notice);
}

// ---------- Sending ----------
let sending = false;
let activeThinkingRow = null;

function friendlyErrorText(err) {
  if (err?.code === "PERMISSION_DENIED") {
    return "Couldn't reach Eith's database — the Firebase rules for this app may not be set up yet (see README.md).";
  }
  const hint = getApiKey()
    ? "Check your API key in Settings and try again."
    : "If this keeps happening, the site owner may need to check the server's Gemini setup, or you can add your own key in Settings.";
  return "I couldn't respond just now (" + (err?.message || err) + "). " + hint;
}

function showLocalErrorBubble(text) {
  if (chatEmptyState?.isConnected) chatEmptyState.remove();
  chatLog.appendChild(buildBubble("eith", text, Date.now(), "error-bubble"));
  chatLog.scrollTop = chatLog.scrollHeight;
}

function resetSendState() {
  activeThinkingRow?.remove();
  activeThinkingRow = null;
  sending = false;
  sendBtn.disabled = false;
}

// Belt-and-suspenders: some Firebase SDK write failures (e.g. rules not yet
// covering this app's path) can surface as a promise rejection outside the
// try/catch below. Without this, the composer would stay stuck disabled.
window.addEventListener("unhandledrejection", (event) => {
  if (!sending) return;
  console.error("Unhandled rejection while sending:", event.reason);
  event.preventDefault();
  showLocalErrorBubble(friendlyErrorText(event.reason));
  resetSendState();
});

composerForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (sending) return;

  const text = composerInput.value.trim();
  if (!text) return;
  if (!activeConversationId) return; // still initializing

  composerInput.value = "";
  composerInput.style.height = "auto";
  sending = true;
  sendBtn.disabled = true;

  const targetConvId = activeConversationId; // pin, in case the user switches conversations mid-send
  const isFirstMessage = latestMessages.length === 0;
  const userMsg = { role: "user", text, ts: Date.now() };

  try {
    await dbPush(conversationMessagesRef(targetConvId), userMsg);
    touchConversationMeta(targetConvId, {
      updatedAt: Date.now(),
      ...(isFirstMessage ? { title: deriveTitle(text) } : {}),
    });

    activeThinkingRow = buildBubble("eith", "Eith is thinking…", null, "thinking");
    chatLog.appendChild(activeThinkingRow);
    chatLog.scrollTop = chatLog.scrollHeight;

    const historyForCall = [...latestMessages, userMsg];
    const replyRaw = await callGemini(historyForCall, latestMemory, getUserName());
    const { text: replyText, facts } = extractMemory(replyRaw);

    await dbPush(conversationMessagesRef(targetConvId), { role: "eith", text: replyText || "…", ts: Date.now() });
    touchConversationMeta(targetConvId, { updatedAt: Date.now() });

    for (const fact of facts) {
      const normalized = fact.toLowerCase();
      const alreadyKnown = latestMemory.some((f) => f.text.toLowerCase() === normalized);
      if (!alreadyKnown) {
        await dbPush(memoryRef, { text: fact, addedAt: Date.now() });
      }
    }
  } catch (err) {
    if (!sending) return; // already handled by the unhandledrejection fallback above
    console.error(err);
    const friendly = friendlyErrorText(err);
    try {
      await dbPush(conversationMessagesRef(targetConvId), { role: "eith", text: friendly, ts: Date.now() });
    } catch {
      // Firebase itself is unreachable — fall back to a local-only bubble so the user isn't left staring at a stuck send button.
      showLocalErrorBubble(friendly);
    }
  } finally {
    if (sending) resetSendState();
    composerInput.focus();
  }
});

// ---------- Danger zone ----------
clearChatBtn.addEventListener("click", async () => {
  if (!activeConversationId) return;
  if (!confirm("Clear this conversation's messages on every device? This can't be undone.")) return;
  try {
    await dbSet(conversationMessagesRef(activeConversationId), null);
    await dbUpdate(conversationMetaRef(activeConversationId), { title: "New conversation", updatedAt: Date.now() });
    closeSettings();
  } catch (err) {
    console.error(err);
    apiKeyStatus.textContent = "Couldn't clear the conversation — check the Firebase setup in README.md.";
    apiKeyStatus.className = "field-status warn";
  }
});

forgetAllBtn.addEventListener("click", async () => {
  if (!confirm("Erase everything Eith knows about you, on every device? This can't be undone.")) return;
  try {
    await dbSet(memoryRef, null);
    closeMemory();
  } catch (err) {
    console.error(err);
    alert("Couldn't clear memory — check the Firebase setup in README.md.");
  }
});
