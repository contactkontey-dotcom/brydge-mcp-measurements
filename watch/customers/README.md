# Customer approved lists

One file per customer: `watch/customers/<customer>.json`, in the format of
`watch/approved.json` — keyed `package@version`, each entry holding the tools,
hosts and programs that customer approved for that version.

**Nothing in this directory is committed.** `.gitignore` excludes everything
here except this file and `.gitkeep`. A customer's list names every tool,
website and program they run and have signed off on, which is a map of their
internal tooling. They gave it to us; it is not ours to publish, and a
repository that is public by design is the wrong place for it even once.

Checked by `test/watch-customers.test.ts`, which fails if any file here other
than these two is tracked by git.

    node watch/cli.ts approve <package@version> [who] --list watch/customers/acme.json
    node watch/cli.ts check   <package@version>       --list watch/customers/acme.json
