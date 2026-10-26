#!/usr/bin/env python3
"""Bushin <-> Codex CLI read-only pairing and echo test.

Run from a Codespaces terminal where "codex login status" shows a ChatGPT login.
The ChatGPT OAuth credentials never leave that Codespaces instance.
"""
from __future__ import annotations

import getpass
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

BASE = "https://bushin-discord-direct.henrique-silva081106.workers.dev"
STORE = Path.home() / ".config" / "bushin" / "codex-bridge.json"
EXPECTED = "BUSHIN_CODEX_OK"
WORKDIR = Path(__file__).resolve().parent.parent


def request(path: str, token: str | None = None, data: dict | None = None) -> dict:
    headers = {"Accept": "application/json", "User-Agent": "Bushin-Codex-Bridge/1"}
    if token:
        headers["Authorization"] = "Bearer " + token
    if data is not None:
        headers["Content-Type"] = "application/json"
    body = json.dumps(data).encode() if data is not None else None
    req = Request(BASE + path, data=body, headers=headers, method="POST" if body is not None else "GET")
    try:
        with urlopen(req, timeout=20) as response:
            return json.load(response)
    except HTTPError as err:
        try:
            detail = json.load(err)
        except (ValueError, OSError):
            detail = {}
        message = detail.get("error") if isinstance(detail, dict) else None
        raise RuntimeError(message or f"Servidor Bushin retornou HTTP {err.code}") from None
    except URLError as err:
        raise RuntimeError("Não foi possível alcançar o Worker da Cloudflare.") from err


def load_token() -> str | None:
    if not STORE.is_file():
        return None
    try:
        obj = json.loads(STORE.read_text(encoding="utf-8"))
        token = obj.get("token")
        if isinstance(token, str) and len(token) == 64:
            return token
    except (ValueError, OSError):
        pass
    return None


def save_token(token: str) -> None:
    STORE.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    fd = os.open(STORE, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as file:
            json.dump({"token": token, "base": BASE}, file)
    finally:
        STORE.chmod(0o600)


def pair() -> str:
    print("Abra o Bushin > Discord 2 > Conectar Codex > Gerar código de pareamento.")
    code = getpass.getpass("Cole o código de pareamento do Bushin: ").strip()
    if len(code) != 64 or any(c not in "0123456789abcdef" for c in code):
        raise RuntimeError("Código inválido. Gere um código novo no painel Bushin.")
    response = request("/internal/codex-bridge/pair", data={"pair_code": code})
    token = response.get("agent_token")
    if not isinstance(token, str) or len(token) != 64:
        raise RuntimeError("O servidor não confirmou o pareamento.")
    save_token(token)
    print("✅ Pareamento concluído. Não envie este token a ninguém.")
    return token


def codex_infer(prompt: str, is_chat: bool = False) -> tuple[bool, str]:
    """Fixed echo or bounded read-only RPG advice; no Discord commands are executed."""
    if not shutil.which("codex"):
        return False, "Codex CLI não instalado neste Codespaces."
    if is_chat:
        if not prompt.startswith("BUSHIN_CODEX_CHAT_V1\n") or len(prompt) > 10500:
            return False, "Solicitação de chat não reconhecida."
    elif prompt != "Responda apenas: " + EXPECTED:
        return False, "Prompt do teste não permitido."
    # Run in a temporary empty directory, not in the RPG repo or Codex's project.
    with tempfile.TemporaryDirectory(prefix="bushin-codex-") as tmp:
        output_file = Path(tmp) / "final.txt"
        command = [
            "codex", "exec", "--ephemeral", "--skip-git-repo-check",
            "--sandbox", "read-only", "--output-last-message", str(output_file),
            prompt,
        ]
        safe_env_names = (
            "PATH", "HOME", "USER", "LANG", "LC_ALL", "TERM", "CODEX_HOME",
            "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY",
            "http_proxy", "https_proxy", "all_proxy", "no_proxy",
            "SSL_CERT_FILE", "SSL_CERT_DIR",
        )
        safe_env = {key: os.environ[key] for key in safe_env_names if key in os.environ}
        try:
            result = subprocess.run(
                command, cwd=tmp, env=safe_env, capture_output=True,
                text=True, timeout=150, check=False,
            )
        except subprocess.TimeoutExpired:
            return False, "Codex ultrapassou 150 segundos."
        except OSError:
            return False, "Não foi possível iniciar o Codex CLI."
        try:
            output = output_file.read_text(encoding="utf-8").strip()
        except OSError:
            output = ""
        if result.returncode == 0:
            if is_chat and output:
                return True, output[:2600]
            if not is_chat and output == EXPECTED:
                return True, EXPECTED
        return False, "Codex não retornou uma resposta válida. Confira sua sessão com 'codex login status'."


def codex_echo(prompt: str) -> tuple[bool, str]:
    return codex_infer(prompt, is_chat=False)


def codex_chat(prompt: str) -> tuple[bool, str]:
    return codex_infer(prompt, is_chat=True)


def main() -> int:
    if not shutil.which("codex"):
        print("Instale com: npm install -g @openai/codex@latest")
        return 1
    status = subprocess.run(["codex", "login", "status"], capture_output=True, text=True, timeout=20)
    if status.returncode:
        print("Codex não está autenticado neste Codespaces. Execute: codex login --device-auth")
        return 1
    print("🍥 Codex autenticado neste Codespaces.")
    token = load_token()
    if not token:
        token = pair()
    print("🔄 Ponte Bushin ativa; mantenha este terminal aberto. Ctrl+C para parar.")
    try:
        while True:
            try:
                queue = request("/internal/codex-bridge/queue?capabilities=chat-v1", token=token)
                job = queue.get("job")
                if job:
                    if job.get("kind") not in ("echo", "chat") or not isinstance(job.get("id"), str):
                        print("Recebi uma solicitação desconhecida; não vou executar.")
                    else:
                        chat = job.get("kind") == "chat"
                        print("🤖 Respondendo chat do Bushin..." if chat else "🤖 Executando teste seguro do Codex...")
                        prompt = str(job.get("prompt") or "")
                        success, message = codex_chat(prompt) if chat else codex_echo(prompt)
                        request("/internal/codex-bridge/result", token=token, data={
                            "id": job["id"], "success": success,
                            "output": message if success else "",
                            "error": "" if success else message,
                        })
                        print("✅ Resposta entregue ao chat Bushin." if success and chat else
                              "✅ Teste enviado ao Bushin." if success else "⚠️ Codex falhou: " + message)
            except RuntimeError as exc:
                message = str(exc)
                print("⚠️ " + message, file=sys.stderr)
                if "Acesso negado" in message:
                    print("Credencial de pareamento revogada. Gere um novo código no Bushin.")
                    try:
                        STORE.unlink(missing_ok=True)
                    except OSError:
                        pass
                    return 1
            time.sleep(5)
    except KeyboardInterrupt:
        print("\n⏹ Ponte pausada no Codespaces.")
        return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (RuntimeError, subprocess.TimeoutExpired) as error:
        print("⚠️ " + str(error), file=sys.stderr)
        sys.exit(1)
