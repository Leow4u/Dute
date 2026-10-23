#!/usr/bin/env python3
"""Gera o ícone e o favicon do app e do site a partir de uma arte quadrada.

Uso (da raiz do repositório):

    python tools/gerar_icones.py caminho/da/arte-1024.png

A arte deve ser quadrada (1024 × 1024 ou maior), já com o fundo: é ela que
vira o ícone do PWA (`any maskable`), o ícone da tela inicial do iPhone e o
favicon. Saídas, sobrescritas:

- artifacts/app/public/dutelog-mark-32.png, -64.png, -180.png
  (favicon e apple-touch-icon de artifacts/app/index.html; o demo lê o -32)
- artifacts/app/public/dutelog-pwa-192.png, -512.png
  (manifest do PWA em artifacts/app/vite.config.ts)
- artifacts/dutelog-site/public/favicon.png (site, index.html e 404.html)

`favicon.svg` e `logo.svg` não mudam: o primeiro embute o -64.png, o segundo
é o logotipo com o nome, não o ícone.
"""

from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image

RAIZ = Path(__file__).resolve().parent.parent
SAIDAS = {
    "artifacts/app/public/dutelog-mark-32.png": 32,
    "artifacts/app/public/dutelog-mark-64.png": 64,
    "artifacts/app/public/dutelog-mark-180.png": 180,
    "artifacts/app/public/dutelog-pwa-192.png": 192,
    "artifacts/app/public/dutelog-pwa-512.png": 512,
    "artifacts/dutelog-site/public/favicon.png": 64,
}


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print(__doc__)
        return 2
    origem = Path(argv[1])
    arte = Image.open(origem).convert("RGBA")
    largura, altura = arte.size
    if largura != altura:
        print(f"A arte precisa ser quadrada; esta tem {largura} × {altura}.")
        return 1
    if largura < 512:
        print(f"A arte precisa ter ao menos 512 px de lado; esta tem {largura}.")
        return 1
    for relativo, lado in SAIDAS.items():
        destino = RAIZ / relativo
        destino.parent.mkdir(parents=True, exist_ok=True)
        reduzida = arte.resize((lado, lado), Image.LANCZOS)
        reduzida.save(destino, format="PNG", optimize=True)
        print(f"{relativo}: {lado} × {lado}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
