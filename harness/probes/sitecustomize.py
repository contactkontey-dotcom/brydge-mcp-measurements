"""
Loaded into every Python process of a server under measurement (PYTHONPATH). Writes one
JSON line per event to $BRYDGE_PROBE_LOG, exactly as the Node probe does:

  loaded   this process is covered
  env      the first read of one variable from a given call site, with the site
  env-all  the whole environment was enumerated
  open     a file under $HOME was opened, with where in the code it happened (audit hook)

The probe does NOT decide what is a copy and what is a targeted read. It records
every read and the SITE it came from; the analyzer groups by site, and a site
that read most of the environment is a copy, while a site that read a handful is
targeting them. That decision is data, published, rather than a fragile guess
made here — `dict(os.environ)` reads its values in a second pass, after the keys
are iterated, so no in-process flag can reliably bracket it.
"""
import json, os, sys, time, traceback

_LOG = os.environ.get("BRYDGE_PROBE_LOG")
_HOME = os.environ.get("HOME", "")


def _stdlib(fn):
    return "sitecustomize" in fn or "<frozen" in fn or "_collections_abc" in fn or fn.endswith("/os.py")


if _LOG and not getattr(sys, "_brydge_probe", False):
    sys._brydge_probe = True

    def _write(o):
        try:
            o = {"pid": os.getpid(), "ppid": os.getppid(), "t": int(time.time() * 1000), **o}
            with open(_LOG, "a") as f:
                f.write(json.dumps(o) + "\n")
        except Exception:
            pass

    def _where():
        frames = traceback.extract_stack()[:-3]
        return [f"{f.filename}:{f.lineno} {f.name}" for f in frames if "sitecustomize" not in f.filename][-9:]

    def _site(stack):
        # The nearest frame that is the reading code itself, not the stdlib
        # machinery (os.environ.get lives in _collections_abc) that reached it.
        for fr in reversed(stack):
            if not _stdlib(fr.split(" ")[0]):
                return f"{fr.split(' ')[0]}"
        return stack[-1].split(" ")[0] if stack else "?"

    _write({"event": "loaded", "runtime": "python", "argv": sys.argv[:4]})

    _Env = type(os.environ)
    _getitem, _iter = _Env.__getitem__, _Env.__iter__
    _seen = set()  # (key, site) already logged

    def _read(key):
        if key == "BRYDGE_PROBE_LOG":
            return
        stack = _where()
        site = _site(stack)
        tag = (key, site)
        if tag in _seen:
            return
        _seen.add(tag)
        _write({"event": "env", "key": key, "site": site, "stack": stack[:6]})

    def __getitem__(self, key):
        _read(key)
        return _getitem(self, key)

    def __iter__(self):
        _write({"event": "env-all", "stack": _where()})
        return _iter(self)

    _Env.__getitem__, _Env.__iter__ = __getitem__, __iter__

    def _audit(event, args):
        if event == "open" and args and _HOME:
            try:
                p = os.fsdecode(args[0]) if not isinstance(args[0], int) else ""
            except Exception:
                p = ""
            if p.startswith(_HOME):
                _write({"event": "open", "path": p, "via": "open", "stack": _where()})

    sys.addaudithook(_audit)
