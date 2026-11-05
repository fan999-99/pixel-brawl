"""Serve the editable pack over loopback HTTP and open its map walkthrough."""
import argparse, functools, http.server, json, threading, urllib.request, webbrowser
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
class Handler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path=='/__club_map_pack':
            self.send_response(200);self.send_header('Content-Type','application/json');self.end_headers();self.wfile.write(b'{"pack":"club-tiled-v1"}');return
        super().do_GET()
    def end_headers(self):
        self.send_header('Cache-Control','no-cache');super().end_headers()
    def log_message(self, fmt,*args):
        if len(args)>1 and str(args[1]) not in ('200','304'):super().log_message(fmt,*args)
args=argparse.ArgumentParser();args.add_argument('--no-browser',action='store_true');args.add_argument('--port',type=int,default=8127);options=args.parse_args()
server=None
for port in range(options.port,options.port+10):
    try:
        server=http.server.ThreadingHTTPServer(('127.0.0.1',port),functools.partial(Handler,directory=str(ROOT)));break
    except OSError:
        try:
            with urllib.request.urlopen(f'http://127.0.0.1:{port}/__club_map_pack',timeout=1) as r: same=json.load(r).get('pack')=='club-tiled-v1'
            if same:
                url=f'http://127.0.0.1:{port}/preview/index.html'
                if not options.no_browser:webbrowser.open(url)
                print('Existing map preview:',url,flush=True);raise SystemExit(0)
        except (OSError,ValueError):pass
if not server:raise RuntimeError('No free local preview port')
url=f'http://127.0.0.1:{port}/preview/index.html'
print('Map workshop:',url,flush=True)
if not options.no_browser:threading.Timer(.5,lambda:webbrowser.open(url)).start()
try:server.serve_forever()
except KeyboardInterrupt:pass
finally:server.server_close()
