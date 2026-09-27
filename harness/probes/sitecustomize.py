"""
Loaded into every Python process of a server under measurement (PYTHONPATH). Writes one
JSON line per event to $BRYDGE_PROBE_LOG, exactly as the Node probe does:

  loaded   this process is covered
  env      the first read of one variable, with where in the code it happened
  env-all  the whole environment was enumerated or copied
  open     a file under $HOME was opened, with where in the code it happened (audit hook)

Reads made while the environment is being enumerated belong to the enumeration.
"""
import json, os, sys, time, traceback

_LOG = os.environ.get("BRYDGE_PROBE_LOG")
_HOME = os.environ.get("HOME", "")

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

    _write({"event": "loaded", "runtime": "python", "argv": sys.argv[:4]})

    _Env = type(os.environ)
    _getitem, _contains, _iter = _Env.__getitem__, _Env.__contains__, _Env.__iter__
    _seen = set()
    _state = {"enumerating": 0}

    def _read(key):
        if key == "BRYDGE_PROBE_LOG" or _state["enumerating"] or key in _seen:
            return
        _seen.add(key)
        _write({"event": "env", "key": key, "stack": _where()})

    def __getitem__(self, key):
        _read(key)
        return _getitem(self, key)

    def __contains__(self, key):
        _read(key)
        return _contains(self, key)

    def __iter__(self):
        _write({"event": "env-all", "stack": _where()})
        _state["enumerating"] += 1
        try:
            yield from _iter(self)
        finally:
            _state["enumerating"] -= 1

    _Env.__getitem__, _Env.__contains__, _Env.__iter__ = __getitem__, __contains__, __iter__

    def _audit(event, args):
        if event == "open" and args and _HOME:
            try:
                p = os.fsdecode(args[0]) if not isinstance(args[0], int) else ""
            except Exception:
                p = ""
            if p.startswith(_HOME):
                _write({"event": "open", "path": p, "via": "open", "stack": _where()})

    sys.addaudithook(_audit)
