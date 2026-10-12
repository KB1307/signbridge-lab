"""Serve SignBridge Lab on http://localhost:8000 (the camera works on localhost).

python3 serve.py [port]
"""
import functools
import http.server
import os
import sys
import webbrowser


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map,
                      ".wasm": "application/wasm", ".mjs": "text/javascript", ".js": "text/javascript"}

    def log_message(self, *args):
        pass


port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
here = os.path.dirname(os.path.abspath(__file__))
server = http.server.ThreadingHTTPServer(("127.0.0.1", port), functools.partial(Handler, directory=here))
print(f"SignBridge Lab: http://localhost:{port}  (Ctrl+C to stop)", flush=True)
try:
    webbrowser.open(f"http://localhost:{port}")
except Exception:
    pass
try:
    server.serve_forever()
except KeyboardInterrupt:
    pass
