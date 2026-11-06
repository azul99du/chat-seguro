# SAM 2.1 "tiny" (recortador de figurinhas)

- Modelo: SAM 2.1 Hiera-Tiny, Meta (Segment Anything Model 2). Os pesos originais (`facebook/sam2.1-hiera-tiny`) são **Apache License 2.0** (texto em `LICENSE.txt`).
- Arquivos `vision_encoder_int8.*` e `prompt_encoder_mask_decoder_int8.*`: conversão para ONNX com quantização int8 publicada em `onnx-community/sam2.1-hiera-tiny-ONNX` (Hugging Face), usada SEM modificação. Esse repositório de conversão não declara licença na página; a licença dos pesos de origem é a Apache 2.0 acima.
- Roda inteiramente no navegador (ver `sam2.js`); nenhuma foto é enviada a servidor algum.

# ONNX Runtime Web (`vendor/ort/`)

`ort.wasm.min.mjs`, `ort-wasm-simd-threaded.{mjs,wasm}`: pacote npm `onnxruntime-web` 1.31.1, Microsoft, licença MIT (`vendor/ort/LICENSE.txt`), sem modificação.
