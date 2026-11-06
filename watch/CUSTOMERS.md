# Customer lists are not in this repository

They live in **`brydge-watch`**, which is private.

A customer list names the packages and versions one organisation runs and has
signed off on. They gave us that; they did not publish it. This repository is
public by design, and a `.gitignore` is a rule until somebody passes `-f`.

`watch/customers/` used to hold them here, ignored. It is gone. Nothing from it
was ever pushed — `git ls-tree` on the remote confirms the directory never
existed there — but an ignored folder in a public repository is one `git add
-f` away from being a published one, and the folder's own existence invited it.

The list format also changed in the move. A list is now a JSON array of
`package@version` strings and nothing else:

```json
["package-registry-mcp@2.0.0", "@kolbo/mcp@1.128.0"]
```

No tool names, no descriptions, no customer name — files are numbered
(`customer-001.json`). The notice job needs a package and a version to do its
work and nothing more, so it is given nothing more.

The tooling in `watch/` still takes `--list <file>` and will read a list from
anywhere on disk, including a checkout of the private repository. It just does
not keep one here.
