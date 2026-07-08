from __future__ import annotations

import gzip
import hashlib
import json
import os
import shutil
import subprocess
import sys
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

PROJECT_ID = "dute-f7480"
SITE_ID = "dute-f7480"
ROOT = Path(__file__).resolve().parents[1]
PUBLIC_DIR = ROOT / "artifacts" / "btg-inventory" / "dist" / "public"
GCLOUD = (
    os.environ.get("GCLOUD")
    or shutil.which("gcloud")
    or r"C:\Users\leona\AppData\Local\Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd"
)


def access_token() -> str:
    return subprocess.check_output(
        [GCLOUD, "auth", "print-access-token"],
        text=True,
    ).strip()


def request_json(
    method: str,
    url: str,
    token: str,
    body: dict[str, Any] | None = None,
) -> dict[str, Any]:
    data = json.dumps(body).encode() if body is not None else None
    headers = {
        "Authorization": f"Bearer {token}",
        "x-goog-user-project": PROJECT_ID,
    }
    if body is not None:
        headers["Content-Type"] = "application/json"
    request = urllib.request.Request(url, data=data, headers=headers, method=method)
    with urllib.request.urlopen(request) as response:
        payload = response.read()
    return json.loads(payload.decode()) if payload else {}


def post_bytes(url: str, token: str, payload: bytes) -> None:
    request = urllib.request.Request(
        url,
        data=payload,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/octet-stream",
            "x-goog-user-project": PROJECT_ID,
        },
        method="POST",
    )
    with urllib.request.urlopen(request) as response:
        response.read()


def file_path(path: Path) -> str:
    rel = path.relative_to(PUBLIC_DIR).as_posix()
    return f"/{rel}"


def load_files() -> tuple[dict[str, str], dict[str, bytes]]:
    files: dict[str, str] = {}
    gzipped_by_hash: dict[str, bytes] = {}

    for path in sorted(PUBLIC_DIR.rglob("*")):
        if not path.is_file():
            continue
        content = path.read_bytes()
        compressed = gzip.compress(content, compresslevel=9, mtime=0)
        digest = hashlib.sha256(compressed).hexdigest()
        files[file_path(path)] = digest
        gzipped_by_hash[digest] = compressed

    return files, gzipped_by_hash


def mime_header(path_glob: str, value: str) -> dict[str, Any]:
    return {"glob": path_glob, "headers": {"Content-Type": value}}


def build_config() -> dict[str, Any]:
    headers = [
        {"glob": "/assets/**", "headers": {"Cache-Control": "public,max-age=31536000,immutable"}},
        {"glob": "**", "headers": {"Cache-Control": "no-cache"}},
        mime_header("**/*.html", "text/html; charset=utf-8"),
        mime_header("**/*.js", "text/javascript; charset=utf-8"),
        mime_header("**/*.css", "text/css; charset=utf-8"),
        mime_header("**/*.svg", "image/svg+xml"),
    ]

    return {
        "headers": headers,
        "rewrites": [
            {
                "glob": "**",
                "path": "/index.html",
            }
        ],
    }


def main() -> int:
    if not PUBLIC_DIR.exists():
        print(f"Build não encontrado: {PUBLIC_DIR}", file=sys.stderr)
        return 1

    token = access_token()
    base = "https://firebasehosting.googleapis.com/v1beta1"

    files, gzipped_by_hash = load_files()
    if not files:
        print("Nenhum arquivo encontrado para deploy.", file=sys.stderr)
        return 1

    version = request_json(
        "POST",
        f"{base}/sites/{SITE_ID}/versions",
        token,
        {"config": build_config()},
    )
    version_name = version["name"]

    populate = request_json(
        "POST",
        f"{base}/{version_name}:populateFiles",
        token,
        {"files": files},
    )

    upload_url = populate.get("uploadUrl")
    required_hashes = populate.get("uploadRequiredHashes", [])
    if upload_url:
        for digest in required_hashes:
            upload = f"{upload_url}/{urllib.parse.quote(digest)}"
            post_bytes(upload, token, gzipped_by_hash[digest])

    finalized = request_json(
        "PATCH",
        f"{base}/{version_name}?update_mask=status",
        token,
        {"status": "FINALIZED"},
    )

    release = request_json(
        "POST",
        f"{base}/sites/{SITE_ID}/releases?versionName={urllib.parse.quote(version_name, safe='/')}",
        token,
    )

    print(
        json.dumps(
            {
                "site": SITE_ID,
                "url": f"https://{SITE_ID}.web.app",
                "firebaseapp": f"https://{SITE_ID}.firebaseapp.com",
                "files": len(files),
                "uploaded": len(required_hashes),
                "version": finalized.get("name", version_name),
                "release": release.get("name"),
            },
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
