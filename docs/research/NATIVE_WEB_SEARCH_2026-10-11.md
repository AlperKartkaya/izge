# Yerleşik web araması ve sohbet düzeltmeleri — 11 Ekim 2026

## Karar ve doğrulama

Yeni bir arama motoru/SDK eklenmedi. Codex profili kendi hosted `web_search` aracını kullanır; yalnız planlayıcının ürettiği kamu sorgusu gönderilir, şirket kaynakları arama çağrısına eklenmez. Gerçek `web_search_call` ve sağlayıcının `url_citation` anotasyonları olmadan arama yapılmış/kaynak bulunmuş sayılmaz. Arama kaynak kartı, sağlayıcının atıf çevresindeki özettir; web sayfasından birebir alıntı olduğu iddia edilmez. Arama izni her istekte açıkça seçilir. Varsa mevcut Brave entegrasyonu diğer profiller için korunur.

Mac üzerindeki Codex köprüsüne gerçek `gpt-6-luna` / high isteği ve low yerleşik web araması gönderildi: yanıt tamamlandı; Python resmi sayfasına sağlayıcı atfı döndü. Bu, yalnız test edilen hesap/model içindir; genel hesap garantisi değildir.

| Profil | Yerleşik arama |
| --- | --- |
| Codex GPT-6 Luna | Uygulandı; gerçek köprü çağrısında doğrulandı |
| GLM 5.3 Flash | Bu exact modelin resmi vision şeması yalnız function tool kabul ediyor; destek varmış gibi gösterilmez |
| DeepSeek Flash | Responses `web_search` araçlarını yok sayar; desteklenmez |
| Yerel Ollama/Qwen | Yerel chat endpoint’i hosted web araması çalıştırmaz. Ollama'nın ayrı bulut arama API'si bu kapsamda eklenmedi |
| On-prem | Şirket endpoint'inin yerleşik arama sözleşmesi bilinmiyor; varsayılmadı |

## Birincil kaynaklar

- [OpenAI web search](https://developers.openai.com/api/docs/guides/tools-web-search): `tools:[{"type":"web_search","external_web_access":true}]`, arama çağrıları ve URL anotasyonları.
- [Codex gerçek tool şeması](https://github.com/openai/codex/blob/a07c8ebd57feedc4cf5dfe854c8e9101de54186b/codex-rs/tools/src/tool_spec.rs#L34-L49).
- [OpenAI reasoning](https://developers.openai.com/api/docs/guides/reasoning): çıktı bütçesi reasoning tokenlarını da kapsar, incomplete başarılı yanıt değildir.
- [SIWC preview sınırları](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations): public SIWC route'unda max_output_tokens desteklenmez. Bu kural private `chatgpt.com/backend-api/codex` sözleşmesi yerine varsayılmadı; kullanılan private köprü bütçeleri gerçek çağrıyla denendi.
- [GLM resmi chat OpenAPI](https://docs.z.ai/api-reference/llm/chat-completion.md): text ve Flash vision tool şemaları farklıdır.
- [DeepSeek Responses tools](https://api-docs.deepseek.com/guides/responses_api/#tools): hosted tools ignored.
- [Ollama arama](https://docs.ollama.com/capabilities/web-search): ayrı account/key ve client tool loop gerektirir; yerel inference ile aynı şey değildir.

## Codex çıktı bütçesi

Küçük JSON plan/takip sorusu bütçeleri reasoning eforundan bağımsız biçimde 220–1400 token ile sınırlanmıyor: Codex için efora göre 1024–8192 alt sınır uygulanır. Görünür metin başlamadan veya JSON hazırlanırken max_output_tokens incomplete gelirse 8192'ye kadar büyütülür; kısmi JSON atılır. Kullanıcıya metin akmaya başladıktan sonra otomatik tekrar yapılmaz; aksi halde aynı metin iki kez görünürdü. EOF/incomplete başarısız olarak kalır. Normal metin gerçek zamanlı stream edilir; JSON tamamlanıp doğrulanmadan tüketilmez.

Private OAuth köprüsü resmi genel OpenAI API ürünü değildir; protokol veya hesap politikası değişebilir. OAuth anahtarı host'ta kalır, köprü yalnız dar kapsamlı chat + hosted web search kabul eder.
