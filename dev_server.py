"""Local development server for the Rank Increase Simulator.

    python dev_server.py [port]        (default port 8844)

Same as `python -m http.server`, but with explicit MIME types: Windows can map
.js to text/plain via the registry, which stops ES modules from loading.
"""

import os
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.abspath(__file__))


class DevHandler(SimpleHTTPRequestHandler):
    extensions_map = {
        **SimpleHTTPRequestHandler.extensions_map,
        ".js": "text/javascript",
        ".wasm": "application/wasm",
        ".gp": "text/plain",
        ".svg": "image/svg+xml",
    }

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def end_headers(self):
        # Always serve fresh files while developing (workers are cached hard).
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8844
    print(f"Serving http://localhost:{port}/")
    ThreadingHTTPServer(("", port), DevHandler).serve_forever()
