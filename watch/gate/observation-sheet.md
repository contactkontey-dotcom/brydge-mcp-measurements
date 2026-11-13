# Observation sheet — the gate in front of a real client

Nothing in this file is filled in. It is a form.

Copy it per run. One sheet covers one client, one server, one mode. The
point is what the **client** does, which no test in this repository can
tell us: a test can prove the gate sent a particular sentence, and only a
person watching a real client can say whether the model read it, ignored it,
retried it, or went in a circle.

**Do not paste tool descriptions into this sheet.** Tool names, counts and
the client's own wording are enough. If a description seems necessary to
explain something, name the tool and the field and leave the text out.

---

## The run

| | |
| --- | --- |
| Date | |
| Who | |
| Client, and version | |
| Server (name and version), or `demo-server --mode=…` | |
| Gate build date / commit | |
| Mode (`shadow` / `enforce`) | |
| `--refusal-style` (`error` / `result`) | |
| Pin: how it was taken (`--write-pin` / `gate pin` / `--from-current`) | |
| Tools in the pin | |
| Exact command line | |

---

## 1. Starting up

| Question | Answer |
| --- | --- |
| Did the client connect at all? | |
| How long before the first tool list, roughly? | |
| Did the client show anything unusual to the user? | |
| Did the server's own stderr reach you? | |
| Anything in the gate's stderr you did not expect? | |

---

## 2. Listing

| Question | Answer |
| --- | --- |
| How many tools did the client show? | |
| How many does the server offer? | |
| Which names were missing, if any? | |
| Did the client list once, or more than once? | |
| **Did it re-list after `notifications/tools/list_changed`?** | |
| How long after the notification? | |
| Did it re-list without being told — on a timer, on a new conversation, on a window change? | |
| Does the client cache the list across restarts? | |

---

## 3. Calling a tool that is not in the list

The case where the client never saw it.

| Question | Answer |
| --- | --- |
| Did the model try to call it anyway? | |
| If so, what made it think the tool was there? | |
| What did the client do with the refusal? | |

---

## 4. Calling a tool the client had already cached

The case the gate is written for: the client listed the tool, then it was
hidden, and the model calls what it remembers.

| Question | Answer |
| --- | --- |
| **What did the model say to the user?** (its own words) | |
| Did the refusal's text reach the model at all, or only a code? | |
| Did the model name the gate, or blame the server or the tool? | |
| Did the model tell the user the action had been stopped, or that it lacked permission? (neither happened — the gate did not forward a message) | |
| **Did it retry?** How many times? | |
| **Did it loop?** Describe the loop and what ended it | |
| Did it try a different tool instead? Which? | |
| Did it tell the user to do something? What? | |
| Did it carry on with the rest of the task, or stop? | |
| Did the client show the user an error of its own? Its wording | |
| Was the session still usable afterwards? | |

---

## 5. A tool the server stopped offering

`dropped-notified` and `dropped-silent`.

| Question | `dropped-notified` | `dropped-silent` |
| --- | --- | --- |
| Did the client re-list? | | |
| Did the model notice the tool was gone? | | |
| What did it say? | | |
| Did it retry? | | |
| Did the gate's "no longer offering" message appear, or the server's own "no such tool"? | | |

---

## 6. The two refusal shapes

Run the same case twice, once with each `--refusal-style`.

| Question | `error` | `result` |
| --- | --- | --- |
| Did the model read the sentence? | | |
| Did it retry? How many times? | | |
| Did the client show the user anything? | | |
| Did the session survive? | | |
| Which one would you rather a tester got by default? | | |

---

## 7. Anything that broke

| Question | Answer |
| --- | --- |
| Did the server behave differently with the gate in front of it? How? | |
| Did anything hang? What was waiting for what? | |
| Did the gate exit? Exit code, and the last `gate:` lines | |
| Did you see a batch? (the gate ends the session under enforcement) | |
| Did the client send anything the gate did not expect? | |
| Anything you had to do by hand to recover | |

---

## 8. Would you leave it on

| Question | Answer |
| --- | --- |
| In shadow mode, for a week? | |
| In enforce mode, on a server you depend on? | |
| What would have to change first? | |
| What was the most annoying part of setting it up? | |
| What did you expect it to do that it did not? | |

---

## 9. Attach

* The gate's `gate:` stderr lines.
* The `--journal` file, if used.
* The client's own log, with tool descriptions removed.
* **Not** a pin and **not** a report: both carry the server's descriptions.
