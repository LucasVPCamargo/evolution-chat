"""
Script para adicionar contatos em massa no Chatwoot via API (versao assincrona)

- Requisicoes paralelas (ate 15 simultaneas)
- Verifica duplicatas por telefone antes de criar
- Le CSV com formato: nome,telefone

Uso:
1. Edite scripts/contatos.csv com os contatos
2. Execute: python scripts/adicionar-contatos-chatwoot.py

Dependencia: pip install aiohttp
"""

import sys
import asyncio
import csv
import json
from pathlib import Path
from dataclasses import dataclass
from datetime import datetime
from typing import List, Dict, Optional, Tuple

try:
    import aiohttp
except ImportError:
    print("Dependencia 'aiohttp' nao encontrada.")
    print("Instale com: pip install aiohttp")
    sys.exit(1)


# ── Configuracao ──────────────────────────────────────────────

CHATWOOT_API_URL = "http://204.168.142.226:3000"
CHATWOOT_API_TOKEN = "7Aj7HiVo1Uqe4cKyHcWsxNZB"
CHATWOOT_ACCOUNT_ID = "2"

CSV_FILE = Path(__file__).parent / "contatos.csv"
MAX_CONCURRENT = 15


@dataclass
class Resultado:
    sucesso: bool
    pulado: bool = False
    erro: Optional[str] = None


def ler_csv(file_path: Path) -> List[Dict[str, str]]:
    contatos = []
    with open(file_path, "r", encoding="utf-8") as f:
        reader = csv.reader(f)
        for i, row in enumerate(reader):
            if not row or not row[0].strip():
                continue
            if i == 0 and ("nome" in row[0].lower() or "telefone" in str(row).lower()):
                continue
            if len(row) >= 2:
                nome = row[0].strip()
                telefone = row[1].strip()
                if nome and telefone:
                    contatos.append({"nome": nome, "telefone": telefone})
    return contatos


def normalizar_telefone(tel: str) -> str:
    num = "".join(filter(str.isdigit, tel))
    if not num.startswith("55"):
        num = "55" + num
    return "+" + num


async def buscar_contato(session: aiohttp.ClientSession, phone: str) -> Optional[Dict]:
    url = (
        f"{CHATWOOT_API_URL}/api/v1/accounts/{CHATWOOT_ACCOUNT_ID}"
        f"/contacts/search?q={phone}&include_contacts=true"
    )
    async with session.get(url) as resp:
        if resp.status != 200:
            return None
        data = await resp.json()
        for contato in data.get("payload", []):
            if contato.get("phone_number") == phone:
                return contato
    return None


async def criar_contato(session: aiohttp.ClientSession, nome: str, telefone: str) -> Resultado:
    phone = normalizar_telefone(telefone)

    existente = await buscar_contato(session, phone)
    if existente:
        return Resultado(sucesso=True, pulado=True)

    url = f"{CHATWOOT_API_URL}/api/v1/accounts/{CHATWOOT_ACCOUNT_ID}/contacts"
    async with session.post(url, json={"name": nome, "phone_number": phone}) as resp:
        body = await resp.text()
        if resp.status in (200, 201):
            return Resultado(sucesso=True)
        if resp.status == 422 and "phone_number" in body.lower():
            return Resultado(sucesso=True, pulado=True)
        return Resultado(sucesso=False, erro=f"HTTP {resp.status} - {body[:200]}")


async def processar_contato(
    session: aiohttp.ClientSession,
    semaphore: asyncio.Semaphore,
    contato: Dict[str, str],
) -> Tuple[str, str, Resultado]:
    async with semaphore:
        resultado = await criar_contato(session, contato["nome"], contato["telefone"])
        return contato["nome"], contato["telefone"], resultado


async def main_async():
    print("=" * 60)
    print("  ADICIONAR CONTATOS NO CHATWOOT VIA API")
    print("=" * 60)
    print()

    if not CSV_FILE.exists():
        print(f"Arquivo nao encontrado: {CSV_FILE}\n")
        print("Crie o arquivo com o seguinte formato:\n")
        print("nome,telefone")
        print("Joao Silva,11999999999")
        print("Maria Santos,11988888888\n")
        sys.exit(1)

    print(f"Lendo: {CSV_FILE}")
    contatos = ler_csv(CSV_FILE)

    if not contatos:
        print("Nenhum contato encontrado no CSV")
        sys.exit(1)

    print(f"{len(contatos)} contatos encontrados\n")

    print("Contatos a serem adicionados:")
    for i, c in enumerate(contatos[:10]):
        print(f"   {i + 1}. {c['nome']} - {c['telefone']}")
    if len(contatos) > 10:
        print(f"   ... e mais {len(contatos) - 10} contatos")
    print()

    print(f"Chatwoot: {CHATWOOT_API_URL}")
    print(f"Account ID: {CHATWOOT_ACCOUNT_ID}")
    print(f"Concorrencia: {MAX_CONCURRENT} requisicoes simultaneas\n")
    print("Iniciando processamento...\n")

    headers = {
        "api_access_token": CHATWOOT_API_TOKEN,
        "Content-Type": "application/json",
    }

    timeout = aiohttp.ClientTimeout(total=30)
    semaphore = asyncio.Semaphore(MAX_CONCURRENT)

    sucesso = 0
    pulado = 0
    falha = 0

    inicio = datetime.now()

    async with aiohttp.ClientSession(headers=headers, timeout=timeout) as session:
        tasks = [
            processar_contato(session, semaphore, contato)
            for contato in contatos
        ]

        for coro in asyncio.as_completed(tasks):
            nome, telefone, resultado = await coro

            if resultado.sucesso:
                if resultado.pulado:
                    print(f"   [EXISTE] {nome} ({telefone})")
                    pulado += 1
                else:
                    print(f"   [CRIADO] {nome} ({telefone})")
                    sucesso += 1
            else:
                print(f"   [ERRO]   {nome} ({telefone}) - {resultado.erro}")
                falha += 1

    duracao = (datetime.now() - inicio).total_seconds()

    print()
    print("=" * 60)
    print("  RESUMO")
    print("=" * 60)
    print(f"Contatos processados: {len(contatos)}")
    print(f"Criados:    {sucesso}")
    print(f"Existentes: {pulado}")
    print(f"Falhas:     {falha}")
    print(f"Tempo:      {duracao:.2f}s")
    if duracao > 0:
        print(f"Velocidade: {len(contatos) / duracao:.1f} contatos/s")
    print("=" * 60)
    print()

    if falha > 0:
        print("Algumas adicoes falharam. Verifique os erros acima.")
    elif pulado > 0 and sucesso == 0:
        print("Todos os contatos ja existiam.")
    else:
        print("Processo concluido com sucesso!")


def main():
    try:
        asyncio.run(main_async())
    except KeyboardInterrupt:
        print("\n\nCancelado pelo usuario.")
        sys.exit(0)
    except Exception as error:
        print(f"\nErro fatal: {error}")
        sys.exit(1)


if __name__ == "__main__":
    main()
