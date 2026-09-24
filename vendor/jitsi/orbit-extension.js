(function() {
  var TRANSLATOR_ID = "orbit-translator";
  var DONATE_ID = "orbit-donate";
  var LIVE_MODEL = "models/gemini-3.5-live-translate-preview";
  var LIVE_SOCKET_URL = "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent";
  var POLL_MS = 1500;
  var DONATION_AMOUNTS = [10, 25, 50, 100];
  var panel = { active: null, target: "en", languages: null, languagesLoading: false };
  var translation = { status: "idle", error: "", source: "", translated: "", signature: "", generation: 0, socket: null, input: null, output: null, sourceNode: null, processor: null, nextTime: 0, playing: [] };
  var hiddenAudio = [];
  var lastAction = { key: "", time: 0 };

  function appStore() {
    if (window.APP && window.APP.store) {
      return window.APP.store;
    }
    return null;
  }

  function appApi() {
    if (window.APP && window.APP.API) {
      return window.APP.API;
    }
    return null;
  }

  function element(name, attributes, children) {
    var node = document.createElement(name);
    var key;
    if (attributes) {
      for (key in attributes) {
        if (!Object.prototype.hasOwnProperty.call(attributes, key)) {
          continue;
        }
        if (key === "text") {
          node.textContent = attributes[key];
        } else if (key === "htmlFor") {
          node.setAttribute("for", attributes[key]);
        } else {
          node.setAttribute(key, attributes[key]);
        }
      }
    }
    (children || []).forEach(function(child) {
      if (typeof child === "string") {
        node.appendChild(document.createTextNode(child));
      } else if (child) {
        node.appendChild(child);
      }
    });
    return node;
  }

  function panelState() {
    var store = appStore();
    if (!store) {
      return null;
    }
    return store.getState()["features/custom-panel"] || null;
  }

  function panelHost() {
    var root = document.getElementById("custom-panel");
    var index;
    if (!root) {
      return null;
    }
    for (index = 0; index < root.children.length; index += 1) {
      var child = root.children[index];
      if (String(child.className || "").indexOf("contentContainer") !== -1) {
        return child;
      }
    }
    return null;
  }

  function setPanelSide(mode) {
    var root = document.getElementById("custom-panel");
    if (!root) {
      return;
    }
    if (mode === "translator") {
      root.setAttribute("data-orbit-side", "left");
    } else if (mode === "donate") {
      root.setAttribute("data-orbit-side", "right");
    } else {
      root.removeAttribute("data-orbit-side");
    }
  }

  function injectPanelSideStyle() {
    if (document.getElementById("orbit-panel-side")) {
      return;
    }
    var style = document.createElement("style");
    style.id = "orbit-panel-side";
    style.textContent = "#custom-panel[data-orbit-side='left']{order:-1;}#custom-panel[data-orbit-side='left'] .customPanelDragHandleContainer{left:auto !important;right:4px !important;}";
    document.head.appendChild(style);
  }

  function closeWrapper() {
    var store = appStore();
    panel.active = null;
    setPanelSide(null);
    stopTranslation();
    try {
      if (store) {
        store.dispatch({ type: "CUSTOM_PANEL_CLOSE" });
      }
    } catch (ignored) {
      return;
    }
    var host = panelHost();
    if (host) {
      host.innerHTML = "";
    }
  }

  function openPanel(mode) {
    var store = appStore();
    if (!store) {
      return;
    }
    try {
      store.dispatch({ type: "SET_CUSTOM_PANEL_ENABLED", enabled: true });
      store.dispatch({ type: "CUSTOM_PANEL_OPEN" });
    } catch (ignored) {
      return;
    }
    panel.active = mode;
    setPanelSide(mode);
    window.setTimeout(renderActivePanel, 60);
    window.setTimeout(renderActivePanel, 450);
  }

  function togglePanel(mode) {
    var state = panelState();
    if (panel.active === mode && state && state.isOpen) {
      closeWrapper();
    } else {
      stopTranslation();
      openPanel(mode);
    }
  }

  function normalizeKey(value) {
    if (typeof value === "string") {
      return value;
    }
    if (value && typeof value === "object") {
      return value.key || value.id || value.buttonKey || value.buttonId || "";
    }
    return "";
  }

  function handleToolbarKey(key) {
    if (key === TRANSLATOR_ID || key === DONATE_ID) {
      lastAction = { key: key, time: Date.now() };
      togglePanel(key === TRANSLATOR_ID ? "translator" : "donate");
    }
  }

  function wrapNotify() {
    var api = appApi();
    if (!api || typeof api.notifyToolbarButtonClicked !== "function" || api.notifyToolbarButtonClicked.orbitWrapped) {
      return;
    }
    var original = api.notifyToolbarButtonClicked;
    var wrapped = function() {
      try {
        handleToolbarKey(normalizeKey(arguments.length > 0 ? arguments[0] : ""));
      } catch (ignored) {
        return original.apply(this, arguments);
      }
      return original.apply(this, arguments);
    };
    wrapped.orbitWrapped = true;
    api.notifyToolbarButtonClicked = wrapped;
  }

  function buttonLabel(node) {
    var label = node.getAttribute("aria-label") || node.getAttribute("title") || node.getAttribute("data-testid") || "";
    if (!label) {
      label = node.textContent || "";
    }
    return String(label).trim().toLowerCase();
  }

  function documentClick(event) {
    var node = event.target && event.target.closest ? event.target.closest("button,[role='button']") : null;
    var image;
    var source;
    if (!node) {
      return;
    }
    image = node.querySelector("img");
    source = image ? String(image.getAttribute("src") || "") : "";
    var label = buttonLabel(node);
    if (source.indexOf("orbit-translator.svg") !== -1 || label === "translator") {
      if (Date.now() - lastAction.time < 500 && lastAction.key === TRANSLATOR_ID) {
        return;
      }
      handleToolbarKey(TRANSLATOR_ID);
      return;
    }
    if (source.indexOf("orbit-donate.svg") !== -1 || label === "donate") {
      if (Date.now() - lastAction.time < 500 && lastAction.key === DONATE_ID) {
        return;
      }
      handleToolbarKey(DONATE_ID);
    }
  }

  function renderActivePanel() {
    var host = panelHost();
    var state = panelState();
    if (!host || !panel.active || !state || !state.isOpen) {
      return;
    }
    var marker = host.querySelector("[data-orbit-panel='" + panel.active + "']");
    if (marker) {
      return;
    }
    host.innerHTML = "";
    if (panel.active === "translator") {
      host.appendChild(renderTranslator());
    } else if (panel.active === "donate") {
      host.appendChild(renderDonate());
    }
  }

  function panelShell(title, body) {
    var wrapper = element("div", { "data-orbit-panel": panel.active, style: "display:flex;flex-direction:column;height:100%;min-height:0;background:inherit;color:inherit;font:inherit;" });
    var header = element("div", { style: "display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 14px 10px;border-bottom:1px solid rgba(128,128,128,.35);" });
    header.appendChild(element("div", { style: "font-size:15px;font-weight:650;" }, [title]));
    var close = element("button", { type: "button", "aria-label": "Close panel", style: "width:34px;height:34px;border:1px solid rgba(128,128,128,.45);border-radius:999px;background:transparent;color:inherit;font-size:18px;line-height:1;cursor:pointer;" }, ["×"]);
    close.addEventListener("click", closeWrapper);
    header.appendChild(close);
    wrapper.appendChild(header);
    wrapper.appendChild(body);
    return wrapper;
  }

  function statusDot(color) {
    return element("span", { style: "width:8px;height:8px;border-radius:999px;background:" + color + ";flex:none;" });
  }

  function loadLanguages(done) {
    if (panel.languages) {
      done(panel.languages);
      return;
    }
    if (panel.languagesLoading) {
      var waiter = window.setInterval(function() {
        if (panel.languages || !panel.languagesLoading) {
          window.clearInterval(waiter);
          done(panel.languages || []);
        }
      }, 250);
      return;
    }
    panel.languagesLoading = true;
    fetch("/api/translation-languages", { headers: { accept: "*/*" } })
      .then(function(response) {
        if (!response.ok) {
          throw new Error("languages");
        }
        return response.json();
      })
      .then(function(languages) {
        panel.languages = Array.isArray(languages) ? languages : [];
        panel.languagesLoading = false;
        done(panel.languages);
      })
      .catch(function() {
        panel.languages = [];
        panel.languagesLoading = false;
        done([]);
      });
  }

  function renderTranslator() {
    var body = element("div", { style: "display:flex;flex-direction:column;min-height:0;flex:1;" });
    var top = element("div", { style: "padding:12px 14px;border-bottom:1px solid rgba(128,128,128,.35);" });
    var label = element("label", { htmlFor: "orbit-language", style: "display:block;font-size:13px;font-weight:600;margin-bottom:8px;" }, ["Translate incoming speech into"]);
    var select = element("select", { id: "orbit-language", style: "width:100%;height:42px;border:1px solid rgba(128,128,128,.55);border-radius:8px;background:rgba(0,0,0,.18);color:inherit;padding:0 10px;font-size:14px;" });
    select.appendChild(element("option", { value: "", text: "Loading languages…" }));
    select.addEventListener("change", function() {
      if (!select.value) {
        return;
      }
      panel.target = select.value;
      syncTranslation();
    });
    top.appendChild(label);
    top.appendChild(select);
    body.appendChild(top);

    var statusRow = element("div", { style: "display:flex;align-items:center;gap:8px;padding:10px 14px;border-bottom:1px solid rgba(128,128,128,.35);font-size:13px;opacity:.9;" });
    var dot = statusDot("#888");
    var statusText = element("span", { id: "orbit-translation-status", text: "Starting…" });
    statusRow.appendChild(dot);
    statusRow.appendChild(statusText);
    body.appendChild(statusRow);

    var scroll = element("div", { style: "flex:1;min-height:0;overflow-y:auto;padding:12px 14px 16px;" });
    scroll.appendChild(element("div", { style: "font-size:12px;font-weight:700;opacity:.75;margin-bottom:4px;" }, ["Original"]));
    scroll.appendChild(element("div", { id: "orbit-source-text", style: "font-size:14px;line-height:1.45;margin-bottom:14px;" }, ["Waiting for participant audio."]));
    scroll.appendChild(element("div", { id: "orbit-target-label", style: "font-size:12px;font-weight:700;opacity:.75;margin-bottom:4px;" }, ["Translation"]));
    scroll.appendChild(element("div", { id: "orbit-translated-text", style: "font-size:14px;line-height:1.45;" }, ["Translation will appear here."]));
    scroll.appendChild(element("div", { style: "margin-top:14px;" }, [
      element("button", { id: "orbit-retry", type: "button", style: "display:none;width:100%;height:42px;border-radius:8px;border:1px solid rgba(128,128,128,.55);background:rgba(255,255,255,.08);color:inherit;font-size:14px;font-weight:600;cursor:pointer;" }, ["Try again"])
    ]));
    body.appendChild(scroll);

    var retry = scroll.querySelector("#orbit-retry");
    if (retry) {
      retry.addEventListener("click", function() {
        stopTranslation();
        syncTranslation();
      });
    }
    loadLanguages(function(languages) {
      if (panel.active !== "translator") {
        return;
      }
      select.innerHTML = "";
      if (!languages.length) {
        select.appendChild(element("option", { value: "", text: "Languages unavailable" }));
        setTranslationError("The language list could not be loaded. Please try again.");
        return;
      }
      languages.forEach(function(language) {
        if (!language || !language.code) {
          return;
        }
        var option = element("option", { value: language.code, text: language.name || language.code });
        if (language.code === panel.target) {
          option.selected = true;
        }
        select.appendChild(option);
      });
      syncTranslation();
    });
    window.setTimeout(syncTranslation, 50);
    return panelShell("Translator", body);
  }

  function renderDonate() {
    var body = element("div", { style: "flex:1;min-height:0;overflow-y:auto;padding:14px;" });
    var card = element("div", { style: "border:1px solid rgba(128,128,128,.4);border-radius:12px;padding:14px;margin-bottom:14px;" });
    card.appendChild(element("div", { style: "font-size:15px;font-weight:700;margin-bottom:6px;" }, ["Support Orbit"]));
    card.appendChild(element("div", { style: "font-size:13.5px;line-height:1.45;opacity:.9;" }, ["Help keep simple, private meetings open to everyone."]));
    body.appendChild(card);
    body.appendChild(element("div", { style: "font-size:13px;font-weight:700;margin-bottom:8px;" }, ["Donation amount"]));
    var grid = element("div", { style: "display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px;" });
    DONATION_AMOUNTS.forEach(function(amount) {
      var choice = element("button", { type: "button", "data-orbit-amount": String(amount), style: "height:44px;border-radius:8px;border:1px solid rgba(128,128,128,.5);background:rgba(255,255,255,.06);color:inherit;font-size:14px;font-weight:650;cursor:pointer;" }, ["$" + amount]);
      choice.addEventListener("click", function() {
        var input = body.querySelector("#orbit-custom-amount");
        if (input) {
          input.value = "";
        }
        donate(amount, body);
      });
      grid.appendChild(choice);
    });
    body.appendChild(grid);
    var customLabel = element("label", { htmlFor: "orbit-custom-amount", style: "display:block;font-size:13px;font-weight:600;margin-bottom:6px;" }, ["Custom amount"]);
    var custom = element("input", { id: "orbit-custom-amount", type: "number", min: "5", max: "500", value: "25", style: "width:100%;height:44px;border:1px solid rgba(128,128,128,.5);border-radius:8px;background:rgba(0,0,0,.18);color:inherit;padding:0 12px;font-size:15px;margin-bottom:12px;" });
    body.appendChild(customLabel);
    body.appendChild(custom);
    var donateButton = element("button", { type: "button", style: "width:100%;height:46px;border:0;border-radius:9px;background:#e7e9ee;color:#0a0a0b;font-size:15px;font-weight:700;cursor:pointer;" }, ["Continue to Stripe"]);
    donateButton.addEventListener("click", function() {
      var amount = Number(custom.value);
      if (!Number.isInteger(amount) || amount < 5 || amount > 500) {
        setDonateMessage(body, "Choose an amount from $5 to $500.", true);
        return;
      }
      donate(amount, body);
    });
    body.appendChild(donateButton);
    body.appendChild(element("div", { id: "orbit-donate-message", role: "status", style: "display:none;margin-top:12px;border:1px solid rgba(128,128,128,.4);border-radius:9px;padding:10px 12px;font-size:13.5px;line-height:1.45;" }));
    return panelShell("Donate", body);
  }

  function setDonateMessage(body, message, isError) {
    var node = body.querySelector("#orbit-donate-message");
    if (!node) {
      return;
    }
    node.style.display = "block";
    node.style.color = isError ? "#ff9d94" : "inherit";
    node.textContent = message;
  }

  function donate(amount, body) {
    var buttons = body.querySelectorAll("button");
    var index;
    for (index = 0; index < buttons.length; index += 1) {
      buttons[index].disabled = true;
    }
    setDonateMessage(body, "Opening checkout…", false);
    fetch("/api/donate", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "*/*" },
      body: JSON.stringify({ amount: amount, returnPath: window.location.pathname || "/" })
    })
      .then(function(response) {
        return response.json().then(function(payload) {
          return { ok: response.ok, payload: payload || {} };
        });
      })
      .then(function(result) {
        var i;
        for (i = 0; i < buttons.length; i += 1) {
          buttons[i].disabled = false;
        }
        if (!result.ok) {
          setDonateMessage(body, result.payload.error || "Checkout could not be created.", true);
          return;
        }
        if (result.payload.mode === "live" && result.payload.url) {
          window.location.assign(result.payload.url);
          return;
        }
        setDonateMessage(body, "Demo donation of $" + amount + " prepared. No payment was taken.", false);
      })
      .catch(function() {
        var i;
        for (i = 0; i < buttons.length; i += 1) {
          buttons[i].disabled = false;
        }
        setDonateMessage(body, "Checkout could not be created.", true);
      });
  }

  function remoteAudioTracks() {
    var store = appStore();
    var state;
    var tracks;
    if (!store) {
      return [];
    }
    state = store.getState();
    tracks = state["features/base/tracks"] || [];
    return tracks.filter(function(track) {
      return track && track.mediaType === "audio" && !track.local && !track.muted && track.isReceivingData !== false && track.jitsiTrack && typeof track.jitsiTrack.attach === "function" && typeof track.jitsiTrack.detach === "function";
    });
  }

  function pruneHiddenAudio(live) {
    hiddenAudio = hiddenAudio.filter(function(entry) {
      var alive = live.some(function(track) {
        return track.jitsiTrack === entry.jitsi;
      });
      if (!alive) {
        try {
          entry.jitsi.detach(entry.element);
        } catch (ignored) {
          return false;
        }
        if (entry.element.parentNode) {
          entry.element.parentNode.removeChild(entry.element);
        }
        return false;
      }
      return true;
    });
  }

  function attachTrack(track) {
    var entry = null;
    var index;
    for (index = 0; index < hiddenAudio.length; index += 1) {
      if (hiddenAudio[index].jitsi === track.jitsiTrack) {
        entry = hiddenAudio[index];
      }
    }
    if (!entry) {
      var audio = document.createElement("audio");
      audio.muted = true;
      audio.setAttribute("aria-hidden", "true");
      audio.style.position = "absolute";
      audio.style.width = "1px";
      audio.style.height = "1px";
      audio.style.left = "-9999px";
      audio.style.opacity = "0";
      audio.style.pointerEvents = "none";
      document.body.appendChild(audio);
      entry = { jitsi: track.jitsiTrack, element: audio, ready: false };
      hiddenAudio.push(entry);
      try {
        var attached = track.jitsiTrack.attach(audio);
        if (attached && typeof attached.then === "function") {
          attached.then(function() {
            entry.ready = true;
            return null;
          }).catch(function() {
            entry.failed = true;
          });
        } else {
          entry.ready = true;
        }
      } catch (ignored) {
        entry.failed = true;
      }
      try {
        var played = audio.play();
        if (played && typeof played.catch === "function") {
          played.catch(function() {
            return null;
          });
        }
      } catch (ignoredPlay) {
        return entry;
      }
    }
    return entry;
  }

  function remoteMedia() {
    var tracks = remoteAudioTracks();
    var stream = new MediaStream();
    var signature = [];
    var ready = true;
    pruneHiddenAudio(tracks);
    tracks.forEach(function(track) {
      var entry = attachTrack(track);
      signature.push(String(track.participantId || "remote"));
      if (!entry || entry.failed || !entry.ready) {
        ready = false;
        return;
      }
      var captured = null;
      try {
        captured = entry.element.captureStream ? entry.element.captureStream() : null;
      } catch (ignored) {
        captured = null;
      }
      if (!captured) {
        ready = false;
        return;
      }
      captured.getAudioTracks().forEach(function(mediaTrack) {
        if (mediaTrack && mediaTrack.readyState === "live" && !stream.getTrackById(mediaTrack.id)) {
          stream.addTrack(mediaTrack);
        }
      });
    });
    if (!stream.getAudioTracks().length || !ready) {
      return null;
    }
    return { stream: stream, signature: signature.sort().join("|") };
  }

  function setTranslationStatus(text, color) {
    var status = document.querySelector("#orbit-translation-status");
    if (status) {
      status.textContent = text;
    }
    var retry = document.querySelector("#orbit-retry");
    if (retry) {
      retry.style.display = translation.status === "error" ? "block" : "none";
    }
    void color;
  }

  function setTranslationText(kind, text) {
    var node = document.querySelector(kind === "source" ? "#orbit-source-text" : "#orbit-translated-text");
    if (node) {
      node.textContent = text;
    }
  }

  function setTranslationError(message) {
    translation.status = "error";
    translation.error = message;
    setTranslationStatus(message, "#ff9d94");
    setTranslationText("source", translation.source || "Waiting for participant audio.");
    setTranslationText("translated", translation.translated || "Translation will appear here.");
    var retry = document.querySelector("#orbit-retry");
    if (retry) {
      retry.style.display = "block";
    }
  }

  function stopTranslation() {
    translation.generation += 1;
    translation.status = "idle";
    translation.error = "";
    translation.signature = "";
    if (translation.socket) {
      try {
        translation.socket.close();
      } catch (ignored) {
        translation.socket = null;
      }
      translation.socket = null;
    }
    if (translation.processor) {
      try {
        translation.processor.disconnect();
      } catch (ignoredDisconnect) {
        translation.processor = null;
      }
      translation.processor = null;
    }
    if (translation.sourceNode) {
      try {
        translation.sourceNode.disconnect();
      } catch (ignoredSource) {
        translation.sourceNode = null;
      }
      translation.sourceNode = null;
    }
    translation.playing.forEach(function(source) {
      try {
        source.stop();
      } catch (ignoredStop) {
        return;
      }
    });
    translation.playing = [];
    translation.nextTime = 0;
    if (translation.input) {
      translation.input.close().catch(function() {
        return null;
      });
      translation.input = null;
    }
    if (translation.output) {
      translation.output.close().catch(function() {
        return null;
      });
      translation.output = null;
    }
    pruneHiddenAudio([]);
  }

  function floatToBase64(input) {
    var bytes = new Uint8Array(input.length * 2);
    var view = new DataView(bytes.buffer);
    var index;
    for (index = 0; index < input.length; index += 1) {
      var sample = Math.max(-1, Math.min(1, input[index]));
      view.setInt16(index * 2, sample < 0 ? sample * 32768 : sample * 32767, true);
    }
    var binary = "";
    for (index = 0; index < bytes.length; index += 0x8000) {
      binary += String.fromCharCode.apply(null, bytes.subarray(index, index + 0x8000));
    }
    return btoa(binary);
  }

  function base64ToBytes(value) {
    var binary = atob(value);
    var bytes = new Uint8Array(binary.length);
    var index;
    for (index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  }

  function scheduleOutput(bytes, output, next) {
    var samples = new Int16Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 2));
    var buffer = output.createBuffer(1, samples.length, 24000);
    var channel = buffer.getChannelData(0);
    var index;
    for (index = 0; index < samples.length; index += 1) {
      channel[index] = samples[index] / 32768;
    }
    var source = output.createBufferSource();
    source.buffer = buffer;
    source.connect(output.destination);
    var startAt = Math.max(output.currentTime + 0.03, next.value);
    source.start(startAt);
    next.value = startAt + buffer.duration;
    translation.playing.push(source);
    source.onended = function() {
      translation.playing = translation.playing.filter(function(item) {
        return item !== source;
      });
    };
  }

  function syncTranslation() {
    var remote;
    if (panel.active !== "translator") {
      return;
    }
    remote = remoteMedia();
    if (!remote) {
      if (translation.signature || translation.status === "connecting" || translation.status === "listening" || translation.status === "playing") {
        stopTranslation();
      }
      translation.status = "idle";
      setTranslationStatus("Waiting for participant audio.", "#888");
      setTranslationText("source", translation.source || "Waiting for participant audio.");
      return;
    }
    if (translation.socket && translation.signature === remote.signature + "|" + panel.target) {
      return;
    }
    stopTranslation();
    startTranslation(remote.stream, remote.signature + "|" + panel.target, panel.target);
  }

  function startTranslation(stream, signature, target) {
    var generation = translation.generation + 1;
    translation.generation = generation;
    translation.status = "connecting";
    translation.error = "";
    translation.signature = signature;
    translation.source = "";
    translation.translated = "";
    setTranslationStatus("Connecting…", "#ffd479");
    setTranslationText("source", "Listening…");
    setTranslationText("translated", "Translation will appear here.");
    var input;
    var output;
    try {
      input = new AudioContext({ sampleRate: 16000 });
      output = new AudioContext({ sampleRate: 24000 });
    } catch (contextError) {
      setTranslationError("This browser cannot start live audio translation.");
      return;
    }
    translation.input = input;
    translation.output = output;
    translation.nextTime = 0;
    input.resume().catch(function() {
      return null;
    });
    output.resume().catch(function() {
      return null;
    });

    fetch("/api/translate-token", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ targetLanguageCode: target })
    })
      .then(function(response) {
        return response.json().then(function(payload) {
          return { ok: response.ok, payload: payload || {} };
        });
      })
      .then(function(result) {
        if (generation !== translation.generation) {
          return;
        }
        if (!result.ok || !result.payload.token || !result.payload.model) {
          setTranslationError(result.payload.error || "Translation could not start. Please try again.");
          stopTranslation();
          translation.status = "error";
          setTranslationError(result.payload.error || "Translation could not start. Please try again.");
          return;
        }
        openLiveSocket(stream, result.payload.token, result.payload.model, target, generation);
      })
      .catch(function() {
        if (generation !== translation.generation) {
          return;
        }
        setTranslationError("Translation could not start. Please try again.");
        stopTranslation();
        translation.status = "error";
        setTranslationError("Translation could not start. Please try again.");
      });
  }

  function openLiveSocket(stream, token, model, target, generation) {
    var socket;
    try {
      socket = new WebSocket(LIVE_SOCKET_URL + "?key=" + encodeURIComponent(token));
    } catch (socketError) {
      setTranslationError("Translation could not start. Please try again.");
      stopTranslation();
      translation.status = "error";
      setTranslationError("Translation could not start. Please try again.");
      return;
    }
    translation.socket = socket;
    socket.onopen = function() {
      if (generation !== translation.generation) {
        return;
      }
      socket.send(JSON.stringify({
        setup: {
          model: model.indexOf("models/") === 0 ? model : "models/" + model,
          generationConfig: {
            responseModalities: ["AUDIO"],
            inputAudioTranscription: {},
            outputAudioTranscription: {},
            translationConfig: { targetLanguageCode: target, echoTargetLanguage: false }
          }
        }
      }));
    };
    socket.onmessage = function(event) {
      var message;
      if (generation !== translation.generation) {
        return;
      }
      try {
        message = JSON.parse(event.data);
      } catch (parseError) {
        return;
      }
      if (message.setupComplete) {
        translation.status = "listening";
        setTranslationStatus("Listening for remote speech.", "#8fd49a");
        startInput(stream, generation);
        return;
      }
      var content = message.serverContent;
      if (!content) {
        return;
      }
      if (content.interrupted) {
        translation.playing.forEach(function(source) {
          try {
            source.stop();
          } catch (ignored) {
            return;
          }
        });
        translation.playing = [];
        translation.nextTime = translation.output ? translation.output.currentTime : 0;
      }
      if (content.inputTranscription && content.inputTranscription.text) {
        translation.source = content.inputTranscription.text;
        setTranslationText("source", translation.source);
      }
      if (content.outputTranscription && content.outputTranscription.text) {
        translation.translated = content.outputTranscription.text;
        translation.status = "playing";
        setTranslationStatus("Playing translation.", "#8fd49a");
        setTranslationText("translated", translation.translated);
      }
      (content.modelTurn && content.modelTurn.parts ? content.modelTurn.parts : []).forEach(function(part) {
        if (!part || !part.inlineData || !part.inlineData.data || String(part.inlineData.mimeType || "").indexOf("audio/") !== 0) {
          return;
        }
        translation.status = "playing";
        setTranslationStatus("Playing translation.", "#8fd49a");
        if (translation.output) {
          scheduleOutput(base64ToBytes(part.inlineData.data), translation.output, { get value() { return translation.nextTime; }, set value(next) { translation.nextTime = next; } });
        }
      });
      if (content.turnComplete) {
        translation.status = "listening";
        setTranslationStatus("Listening for remote speech.", "#8fd49a");
      }
    };
    socket.onerror = function() {
      if (generation !== translation.generation) {
        return;
      }
      setTranslationError("The live translation connection failed. Please try again.");
      stopTranslation();
      translation.status = "error";
      setTranslationError("The live translation connection failed. Please try again.");
    };
    socket.onclose = function() {
      if (generation !== translation.generation) {
        return;
      }
      if (translation.status === "listening" || translation.status === "playing" || translation.status === "connecting") {
        setTranslationError("The live translation connection closed. Please try again.");
        stopTranslation();
        translation.status = "error";
        setTranslationError("The live translation connection closed. Please try again.");
      }
    };
  }

  function downsample(input, fromRate) {
    var rate = fromRate || 16000;
    var ratio;
    var length;
    var output;
    var index;
    var start;
    var end;
    var total;
    var count;
    if (rate === 16000) {
      return input;
    }
    ratio = rate / 16000;
    length = Math.max(1, Math.floor(input.length / ratio));
    output = new Float32Array(length);
    for (index = 0; index < length; index += 1) {
      start = Math.floor(index * ratio);
      end = Math.min(input.length, Math.floor((index + 1) * ratio));
      total = 0;
      count = 0;
      while (start < end) {
        total += input[start];
        start += 1;
        count += 1;
      }
      output[index] = count ? total / count : 0;
    }
    return output;
  }

  function startInput(stream, generation) {
    var input = translation.input;
    var socket = translation.socket;
    if (!input || !socket || generation !== translation.generation || translation.sourceNode) {
      return;
    }
    try {
      var source = input.createMediaStreamSource(stream);
      var processor = input.createScriptProcessor(2048, 1, 1);
      processor.onaudioprocess = function(event) {
        var live;
        if (generation !== translation.generation || !translation.socket || translation.socket.readyState !== 1) {
          return;
        }
        live = downsample(event.inputBuffer.getChannelData(0), input.sampleRate);
        event.outputBuffer.getChannelData(0).fill(0);
        socket.send(JSON.stringify({
          realtimeInput: {
            audio: { data: floatToBase64(live), mimeType: "audio/pcm;rate=16000" }
          }
        }));
      };
      source.connect(processor);
      processor.connect(input.destination);
      translation.sourceNode = source;
      translation.processor = processor;
    } catch (inputError) {
      setTranslationError("This browser cannot capture remote meeting audio.");
      stopTranslation();
      translation.status = "error";
      setTranslationError("This browser cannot capture remote meeting audio.");
    }
  }

  function poll() {
    var store = appStore();
    if (!store) {
      return;
    }
    wrapNotify();
    if (panel.active === "translator") {
      syncTranslation();
    }
    var state = panelState();
    if (panel.active && (!state || !state.isOpen)) {
      closeWrapper();
      return;
    }
    renderActivePanel();
  }

  function boot() {
    if (!window.APP || !appApi() || !appStore()) {
      window.setTimeout(boot, 250);
      return;
    }
    wrapNotify();
    injectPanelSideStyle();
    document.addEventListener("click", documentClick, true);
    window.setInterval(poll, POLL_MS);
    window.setTimeout(poll, 250);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
