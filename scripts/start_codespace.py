#!/usr/bin/env python3
"""Run the existing executor from Codespaces without exposing credentials."""
import argparse
import fcntl
import os
from pathlib import Path
import shutil
import subprocess
import sys

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--check', action='store_true', help='Validate configuration without connecting')
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    branch = subprocess.check_output(['git', 'branch', '--show-current'], cwd=root, text=True).strip()
    if branch != 'Projeto':
        raise SystemExit('Abra a branch Projeto. Nenhum arquivo foi trocado automaticamente.')
    required = ('DISCORD_USER_TOKEN', 'BUSHIN_EXECUTOR_TOKEN')
    missing = [name for name in required if not os.environ.get(name)]
    if missing:
        raise SystemExit('Faltam secrets do Codespaces: ' + ', '.join(missing) + '. Não cole valores no chat.')
    if len(os.environ['BUSHIN_EXECUTOR_TOKEN']) < 43:
        raise SystemExit('BUSHIN_EXECUTOR_TOKEN inválido: deve corresponder ao Secret do Worker (mínimo 43 caracteres).')
    if args.check:
        print('Configuração local presente. Conexão e resposta do modelo ainda não testadas.')
        return
    runtime = Path.home() / '.local' / 'share' / 'bushin-codespace'
    runtime.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.chmod(runtime, 0o700)
    lock = (runtime / 'executor.lock').open('a')
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        raise SystemExit('Já existe um executor neste Codespace.')
    venv = runtime / 'venv'
    if not (venv / 'bin' / 'python').exists():
        subprocess.run([sys.executable, '-m', 'venv', str(venv)], check=True)
    python = str(venv / 'bin' / 'python')
    subprocess.run([python, '-m', 'pip', 'install', '--disable-pip-version-check', '-r',
                    str(root / 'scripts' / 'naruto-panel-requirements.txt')], check=True)
    if not shutil.which('opencode'):
        if not shutil.which('npm'):
            raise SystemExit('Node/npm ausente neste Codespace.')
        subprocess.run(['npm', 'install', '--global', 'opencode-ai@1.19.4'], check=True)
    env = os.environ.copy()
    env['BUSHIN_STATE_DIR'] = str(runtime / 'state')
    env.setdefault('RPG_MODEL', 'opencode/glm-5.3-flash-free')
    env['PYTHONDONTWRITEBYTECODE'] = '1'
    print('Iniciando executor. Pare com Ctrl+C. Nenhuma chave será exibida.', flush=True)
    # Keep this parent and its single-instance lock alive until the executor exits.
    child = subprocess.Popen([python, str(root / 'scripts' / 'command_service.py')], cwd=root, env=env)
    try:
        raise SystemExit(child.wait())
    except KeyboardInterrupt:
        child.terminate()
        try:
            child.wait(timeout=10)
        except subprocess.TimeoutExpired:
            child.kill()
            child.wait()

if __name__ == '__main__':
    main()
