import { initializeBindings } from "./bindings.js";
import { handleAuthFailure, handleEnvelope } from "./handlers.js";
import { state } from "./state.js";
import { boot } from "./transport.js";
import { storeToken } from "./ui.js";

function decodeParameterPart(value) {
  try {
    return decodeURIComponent(value.replace(/\+/g, " "));
  } catch {
    return value;
  }
}

function consumeTokenFromFragment(hash) {
  const fragment = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!fragment) return { token: null, nextHash: hash, stripped: false };

  const keptParts = [];
  let token = null;
  let stripped = false;

  for (const part of fragment.split("&")) {
    const equalsIndex = part.indexOf("=");
    const rawKey = equalsIndex === -1 ? part : part.slice(0, equalsIndex);
    const rawValue = equalsIndex === -1 ? "" : part.slice(equalsIndex + 1);

    if (decodeParameterPart(rawKey) === "token") {
      if (token === null) token = decodeParameterPart(rawValue);
      stripped = true;
      continue;
    }

    keptParts.push(part);
  }

  return {
    token,
    nextHash: keptParts.length ? `#${keptParts.join("&")}` : "",
    stripped,
  };
}

function consumeLoginTokenFromUrl() {
  const url = new URL(window.location.href);
  const fragmentToken = consumeTokenFromFragment(url.hash);
  const queryToken = url.searchParams.get("token");
  const token = fragmentToken.token ?? queryToken;
  const shouldStrip = fragmentToken.stripped || queryToken !== null;

  if (!shouldStrip) return;

  if (token !== null) {
    state.token = token;
    storeToken(token);
  }

  url.searchParams.delete("token");
  url.hash = fragmentToken.nextHash;
  window.history.replaceState({}, document.title, `${url.pathname}${url.search}${url.hash}` || "/");
}

consumeLoginTokenFromUrl();
initializeBindings({ handleEnvelope, handleAuthFailure });
boot({ handleEnvelope, handleAuthFailure });
