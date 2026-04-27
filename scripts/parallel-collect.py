#!/usr/bin/env python3
"""Parallel-fire collectLeague for a list of league IDs.
Reads /tmp/stale_ids.txt, fires CLOUD_RUN_URL/collectLeague POST per league,
limited concurrency, logs results, writes report to /tmp/collect-results.json.
"""
import json, os, sys, time, urllib.request, urllib.error
from concurrent.futures import ThreadPoolExecutor, as_completed
import subprocess

URL = "https://collectleague-skvs47y5zq-uc.a.run.app/"
CONCURRENCY = 6  # per-league timeout up to ~5min; 6x parallel keeps under load

ids_path = sys.argv[1] if len(sys.argv) > 1 else "/tmp/stale_ids.txt"
out_path = sys.argv[2] if len(sys.argv) > 2 else "/tmp/collect-results.json"

with open(ids_path) as f:
    league_ids = [l.strip() for l in f if l.strip()]

# Get an OIDC token for the Cloud Run service (same project, admin@teamsunited.com identity)
# Endpoint is public (allUsers invoker), no auth needed
token = None

def collect_one(league_id):
    body = json.dumps({"leagueId": league_id}).encode()
    req = urllib.request.Request(URL, data=body, method="POST")
    req.add_header("Content-Type", "application/json")
    t0 = time.time()
    try:
        with urllib.request.urlopen(req, timeout=540) as resp:
            data = json.loads(resp.read())
            return {"id": league_id, "ok": True, "ms": int((time.time()-t0)*1000),
                    "divisions": data.get("divisions"), "standings": data.get("standings")}
    except urllib.error.HTTPError as e:
        body = e.read().decode(errors="replace")[:300]
        return {"id": league_id, "ok": False, "ms": int((time.time()-t0)*1000),
                "status": e.code, "error": body}
    except Exception as e:
        return {"id": league_id, "ok": False, "ms": int((time.time()-t0)*1000),
                "error": str(e)[:300]}

results = []
print(f"Collecting {len(league_ids)} leagues, concurrency={CONCURRENCY}")
start = time.time()
with ThreadPoolExecutor(max_workers=CONCURRENCY) as ex:
    futures = {ex.submit(collect_one, lid): lid for lid in league_ids}
    done = 0
    for f in as_completed(futures):
        r = f.result()
        results.append(r)
        done += 1
        if done % 10 == 0 or not r["ok"]:
            mark = "✓" if r["ok"] else "✗"
            print(f"[{done}/{len(league_ids)}] {mark} {r['id']} ({r['ms']}ms){' '+r.get('error','')[:80] if not r['ok'] else ''}")

elapsed = int(time.time()-start)
ok = sum(1 for r in results if r["ok"])
print(f"\nDone in {elapsed}s. {ok}/{len(results)} succeeded.")
with open(out_path,"w") as f:
    json.dump({"elapsed_s": elapsed, "ok": ok, "total": len(results), "results": results}, f, indent=2)
print(f"Report: {out_path}")
