# MediaPipe (recorte inteligente das figurinhas)

Arquivos de terceiros usados SEM modificação:

- `vision_bundle.mjs`, `wasm/vision_wasm_internal.{js,wasm}`: pacote npm `@mediapipe/tasks-vision` 1.2.2 (ver `mediapipe-package.json`), Google, Apache License 2.0.
- `interactive_segmentation.task`: modelo "Magic Touch" (Interactive Segmenter v2, int8), Google. O cartão do modelo (Model Card MagicTouch) o declara sob Apache License, Version 2.0.
  Origem: https://storage.googleapis.com/mediapipe-models/interactive_segmenter_v2/magic_touch/int8/latest/interactive_segmentation.task

O texto da licença está em `LICENSE.txt`. Eles rodam inteiramente no navegador da pessoa; nenhuma imagem é enviada a servidor algum.
