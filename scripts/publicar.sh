#!/usr/bin/env bash
# Publicação em duas etapas, para a suíte completa rodar UMA vez só (no GitHub) e a main nunca receber código sem ela:
#   scripts/publicar.sh teste   envia o commit atual à branch "ci/teste" e espera a suíte completa terminar
#   scripts/publicar.sh main    leva o MESMO commit (mesmo hash) para a main, que publica o site; recusa se ele não passou
# Mudança de banco: aplique no projeto de teste ANTES da etapa "teste" e no banco real entre as duas etapas (banco primeiro, depois o código).
set -euo pipefail
fase="${1:-}"; sha=$(git rev-parse HEAD); repo=$(git config --get remote.origin.url | sed -E 's#(git@github.com:|https://github.com/)##; s#\.git$##')
ci_passou() { gh api "repos/$repo/actions/workflows/ci.yml/runs?head_sha=$sha&status=success&per_page=20" --jq '[.workflow_runs[] | select(.event=="push" and .head_branch!="main" and .head_sha=="'"$sha"'")] | length'; }
case "$fase" in
  teste)
    git diff --quiet && git diff --cached --quiet || { echo "ERRO: há mudanças sem commit."; exit 1; }
    node scripts/versionar.mjs --check
    git push --force origin "$sha:refs/heads/ci/teste"
    id=""; for i in $(seq 1 24); do id=$(gh run list --commit "$sha" --workflow CI --branch ci/teste --json databaseId --jq '.[0].databaseId // empty'); [ -n "$id" ] && break; sleep 10; done
    [ -n "$id" ] || { echo "ERRO: o GitHub não iniciou o CI para $sha (fila ou queda: veja https://www.githubstatus.com)."; exit 2; }
    echo "CI: https://github.com/$repo/actions/runs/$id"
    if timeout 28m gh run watch "$id" --exit-status > /dev/null; then echo "CI PASSOU para $sha. Próximo: scripts/publicar.sh main"; else echo "CI FALHOU (ou passou do tempo) para $sha."; gh run view "$id" --json jobs --jq '.jobs[] | "\(.name): \(.conclusion)"'; exit 3; fi ;;
  main)
    [ "$(ci_passou)" -gt 0 ] || { echo "ERRO: não há CI completo e bem-sucedido para $sha em outra branch. Rode: scripts/publicar.sh teste"; exit 1; }
    git push origin "$sha:refs/heads/main"
    git push origin --delete ci/teste > /dev/null 2>&1 || true
    echo "Publicado: $sha está na main (o site atualiza em poucos minutos)." ;;
  *) echo "uso: scripts/publicar.sh teste | main"; exit 64 ;;
esac
