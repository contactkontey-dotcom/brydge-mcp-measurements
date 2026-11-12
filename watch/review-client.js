/*
 * ═══════════════════════════════════════════════════════════════════════════
 * THE REVIEW PAGE, IN THE BROWSER. NO NETWORK, NO MARKUP, NO STORAGE.
 *
 * Every string that came from a server reaches the document through
 * `textContent`. There is no `innerHTML` in this file, no `insertAdjacentHTML`
 * and no `document.write`, and a test asserts their absence rather than
 * trusting whoever read this. A description is untrusted text: it is shown,
 * never run, and never interpreted.
 *
 * No fetch, XMLHttpRequest, sendBeacon, WebSocket, EventSource, localStorage,
 * sessionStorage, indexedDB or document.cookie is used. The page's
 * Content-Security-Policy is `default-src 'none'` and forbids all of it
 * regardless; this file does not reach for any of it in the first place. (A
 * test strips comments before checking, so naming them here to say they are
 * unused does not trip it.)
 *
 * Decisions live in a variable until the reviewer asks for them, and then
 * they leave as a file the browser writes. Nothing is remembered between
 * visits: a decision nobody exported is a decision nobody made.
 * ═══════════════════════════════════════════════════════════════════════════
 */
(function () {
  "use strict";

  var DATA = JSON.parse(document.getElementById("data").textContent);
  var decisions = Object.create(null); /* "kind:tool" -> "approve" | "hold" */

  /** An element, with text set as text. */
  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function add(parent, child) {
    parent.appendChild(child);
    return child;
  }

  /**
   * The marked-up text of a word diff, as spans.
   *
   * Each run's text goes in through textContent, and the markers the module
   * put in — the ones that stand for a character with no visible form —
   * are split out so they can be coloured. They are already the only
   * occurrences of those two characters: watch/words.ts escapes any that the
   * text itself carried, so there is nothing here to get wrong.
   */
  var OPEN = "⟦";
  var CLOSE = "⟧";

  function marks(parent, text) {
    var i = 0;
    while (i < text.length) {
      var at = text.indexOf(OPEN, i);
      if (at === -1) {
        add(parent, document.createTextNode(text.slice(i)));
        return;
      }
      var end = text.indexOf(CLOSE, at);
      if (end === -1) {
        add(parent, document.createTextNode(text.slice(i)));
        return;
      }
      if (at > i) add(parent, document.createTextNode(text.slice(i, at)));
      add(parent, el("span", "mk", text.slice(at, end + 1)));
      i = end + 1;
    }
  }

  function runsInto(parent, runs) {
    for (var i = 0; i < runs.length; i++) {
      var run = runs[i];
      var cls = run.op === "removed" ? "gone" : run.op === "added" ? "came" : null;
      marks(cls ? add(parent, el("span", cls)) : parent, run.text);
    }
  }

  function size(side) {
    return side.present ? side.characters + (side.characters === 1 ? " character" : " characters") : "none";
  }

  function list(parent, className, lines) {
    if (!lines.length) return;
    var ul = add(parent, el("ul", className));
    for (var i = 0; i < lines.length; i++) add(ul, el("li", null, lines[i]));
  }

  function wordsInto(parent, w) {
    add(parent, el("p", "counts",
      size(w.before) + " → " + size(w.after) + ". " +
      w.wordsRemoved + (w.wordsRemoved === 1 ? " word" : " words") + " removed, " +
      w.wordsAdded + (w.wordsAdded === 1 ? " word" : " words") + " added; " +
      w.charactersRemoved + " characters removed, " + w.charactersAdded + " added."));
    if (!w.wordsRemoved && !w.wordsAdded) {
      add(parent, el("p", "counts", "No word changed: every character that moved is one that is not part of a word."));
    }
    if (w.capped) add(parent, el("p", "counts", "Not aligned word by word: " + w.capped + "."));
    runsInto(add(parent, el("div", "text")), w.runs);
    if (w.legend.length) {
      add(parent, el("p", "counts", "Characters shown by code point above:"));
      list(parent, "legend", w.legend);
    }
  }

  function schemaInto(parent, s) {
    var kind = null;
    var ul = null;
    for (var i = 0; i < s.changes.length; i++) {
      var c = s.changes[i];
      if (c.kind !== kind) {
        kind = c.kind;
        add(parent, el("p", "counts", kind + ":"));
        ul = add(parent, el("ul", "changes"));
      }
      var said = (c.parameter ? c.parameter : c.pointer) + (c.detail ? " — " + c.detail : "");
      var li = add(ul, el("li", null, said));
      if (c.parameter) add(li, el("span", "quiet", "  at " + c.pointer + (c.atCap ? " (a subtree: the walk stopped there)" : "")));
    }
    if (s.unexplained) {
      add(parent, el("p", "counts",
        s.unexplained + " of " + s.pointers + " differing places is not one of the kinds above, and is listed by pointer."));
    }
  }

  function paramsInto(parent, params) {
    add(parent, el("p", "counts", params.length === 0
      ? "It declares no parameters."
      : "It declares " + params.length + (params.length === 1 ? " parameter:" : " parameters:")));
    list(parent, "params", params.map(function (p) {
      return p.parameter + " — " + p.type + (p.required ? ", required" : "");
    }));
  }

  /* ── One item ─────────────────────────────────────────────────────────── */

  function itemKey(item) {
    return item.kind + ":" + item.tool;
  }

  function render() {
    var host = document.getElementById("items");
    while (host.firstChild) host.removeChild(host.firstChild);

    var kinds = ["description", "input schema", "new tool"];
    for (var k = 0; k < kinds.length; k++) {
      var of = DATA.items.filter(function (i) { return i.kind === kinds[k]; });
      if (!of.length) continue;
      add(host, el("h2", null, kinds[k] + " (" + of.length + ")"));
      for (var n = 0; n < of.length; n++) host.appendChild(card(of[n]));
    }
    said();
  }

  function card(item) {
    var box = el("div", "item");
    /* The key as an attribute, not as an id: an item key holds a colon, and
     * an id built by percent-encoding it cannot be written as a CSS
     * selector at all. setAttribute takes the raw key, and
     * [data-key="description:nasty"] selects it. */
    box.setAttribute("data-key", itemKey(item));
    var head = add(box, el("header", null));
    add(head, el("span", "tool", item.tool));
    add(head, el("span", "kind", item.kind));

    if (item.kind === "new tool") {
      add(box, el("p", "counts", item.words && item.words.after.present
        ? "It was not in " + DATA.from + ". What it says about itself:"
        : "It was not in " + DATA.from + ", and it says nothing about itself."));
    }
    if (item.words) wordsInto(box, item.words);
    if (item.schema) schemaInto(box, item.schema);
    if (item.parameters) paramsInto(box, item.parameters);

    var row = add(box, el("div", "decide"));
    var approve = add(row, el("button", "a", "Approve"));
    var hold = add(row, el("button", "h", "Hold"));
    var state = add(row, el("span", "state"));
    var key = itemKey(item);

    function paint() {
      var now = decisions[key] || null;
      box.setAttribute("data-decision", now || "");
      approve.setAttribute("aria-pressed", String(now === "approve"));
      hold.setAttribute("aria-pressed", String(now === "hold"));
      state.textContent = now === "approve"
        ? "approved"
        : now === "hold"
          ? "held — looked at, not added to the list, not in the allow rules"
          : "not yet decided";
      said();
    }
    function set(value) {
      if (decisions[key] === value) delete decisions[key];
      else decisions[key] = value;
      paint();
    }
    approve.addEventListener("click", function () { set("approve"); });
    hold.addEventListener("click", function () { set("hold"); });
    paint();
    return box;
  }

  /* ── The bar ──────────────────────────────────────────────────────────── */

  function counted() {
    var approved = 0;
    var held = 0;
    for (var key in decisions) {
      if (decisions[key] === "approve") approved++;
      else held++;
    }
    return { approved: approved, held: held, left: DATA.items.length - approved - held };
  }

  function said() {
    var c = counted();
    document.getElementById("progress").textContent =
      c.approved + " approved, " + c.held + " held, " + c.left + " not yet decided.";
  }

  function exported() {
    var by = document.getElementById("by").value.trim();
    var at = document.getElementById("at").value.trim();
    if (!by) return { because: "Put your name in the box: a decision needs to say who made it." };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(at)) return { because: "The date has to read YYYY-MM-DD." };
    var out = [];
    for (var i = 0; i < DATA.items.length; i++) {
      var item = DATA.items[i];
      var decision = decisions[itemKey(item)];
      if (!decision) continue;
      out.push({ kind: item.kind, name: item.tool, decision: decision, by: by, at: at, itemHash: item.itemHash });
    }
    if (!out.length) return { because: "Nothing is decided yet." };
    return {
      text: JSON.stringify({
        format: "brydge-review-decisions",
        version: 1,
        package: DATA.package,
        fromVersion: DATA.from,
        toVersion: DATA.to,
        decisions: out,
      }, null, 2) + "\n",
      count: out.length,
    };
  }

  function note(text) {
    document.getElementById("said").textContent = text;
  }

  document.getElementById("export").addEventListener("click", function () {
    var out = exported();
    if (out.because) return note(out.because);
    var url = URL.createObjectURL(new Blob([out.text], { type: "application/json" }));
    var a = el("a", null, null);
    a.href = url;
    a.download = "decisions-" + DATA.package.replace(/[^A-Za-z0-9.-]+/g, "-") + "-" + DATA.to + ".json";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    note(out.count + " decision" + (out.count === 1 ? "" : "s") + " downloaded.");
  });

  document.getElementById("copy").addEventListener("click", function () {
    var out = exported();
    if (out.because) return note(out.because);
    if (!navigator.clipboard) return note("This browser will not let a page write to the clipboard; use the download.");
    navigator.clipboard.writeText(out.text).then(
      function () { note(out.count + " decision" + (out.count === 1 ? "" : "s") + " copied."); },
      function () { note("The copy did not go through; use the download."); },
    );
  });

  /* ── What the page says about itself ──────────────────────────────────── */

  document.getElementById("sub").textContent =
    DATA.items.length + (DATA.items.length === 1 ? " item" : " items") + " to review, from the comparison of " +
    DATA.from + " and " + DATA.to + ", prepared " + DATA.generatedAt + ".";
  document.getElementById("at").value = DATA.generatedAt;

  (function limits() {
    var host = document.getElementById("limits");
    var lines = DATA.notes.slice();
    if (DATA.removed.length) {
      lines.push(DATA.removed.length + (DATA.removed.length === 1 ? " tool is" : " tools are") +
        " in " + DATA.from + " and not in " + DATA.to + ", which is nothing to approve: " + DATA.removed.join(", ") + ".");
    }
    lines.push(DATA.unchanged + (DATA.unchanged === 1 ? " tool is" : " tools are") + " identical between the two versions.");
    lines.push("Approving an item records that you read it. Holding one records that you read it and did not add it to the list, so it is not in the allow rules either. Neither stops anything running.");
    lines.push("No tool was called in any run behind this page, so nothing here is about what a tool does when it is called, or whether it does what it says.");
    lines.push("Both versions were measured in one configuration, with the same fake credentials and no settings of their own.");
    lines.push("The text above is what the server said about its own tools. It is shown as text and nothing here acts on it.");
    for (var i = 0; i < DATA.markerKey.length; i++) lines.push(DATA.markerKey[i]);
    for (var n = 0; n < lines.length; n++) add(host, el("p", "note", lines[n]));
  })();

  render();
})();
