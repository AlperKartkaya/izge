const LANGUAGE_STORAGE_KEY = 'izge.website.language';
const SUPPORTED_LANGUAGES = new Set(['en', 'tr']);

const PAGE_I18N = {
  title: {
    en: 'Izge — Local-First Institutional Memory',
    tr: 'Izge — Local-First Kurumsal Hafıza',
  },
  description: {
    en: 'Izge is a local-first institutional memory and decision intelligence system for reconstructing decisions, governing evidence, using private/local inference, and producing evidence-grounded next actions.',
    tr: 'Izge; kararların neden alındığını, hangi varsayımlara dayandığını ve bugün neyle çeliştiğini kurum sınırı içinde yeniden kuran local-first kurumsal hafıza ve karar mekanizması sistemidir.',
  },
  html: {
    'boundary.deployment.copy': {
      en: '<strong>app.izge.dev</strong> is the jury/pilot surface. The customer target is self-hosted or customer-controlled storage, backend, and local/private inference.',
      tr: '<strong>app.izge.dev</strong> jüri ve pilot kullanım için açılan demo arayüzüdür. Müşteri tarafında hedef; depolamanın, backend’in ve yerel/özel çıkarımın müşterinin kontrolündeki ortamda çalıştığı kurulumdur.',
    },
  },
  aria: {
    'Izge home': 'Izge ana sayfa',
    'Site navigation': 'Site navigasyonu',
    'Language selector': 'Dil seçici',
    'Primary actions': 'Birincil eylemler',
    'Interactive memory weave: decision lineage, contradiction, and next action': 'Etkileşimli hafıza örgüsü: karar geçmişi, çelişki ve sonraki adım',
    'Memory weave states': 'Hafıza örgüsü durumları',
    'Show calm pattern': 'Sakin deseni göster',
    'Show decision thread': 'Karar hattını göster',
    'Show supporting structure': 'Destekleyici yapıyı göster',
    'Show contradiction tension': 'Çelişki gerilimini göster',
    'Show next-action path': 'Sonraki adım yolunu göster',
    'Evidence reconstruction': 'Kanıtların yeniden kurulması',
    'Decision reconstruction steps': 'Kararı yeniden kurma adımları',
    'Broken organizational memory visualization': 'Bozulmuş kurumsal hafıza görselleştirmesi',
    'Izge inference and authority boundary': 'Izge çıkarım ve otorite sınırı',
    'Admin and member operating model': 'Admin ve üye işleyiş modeli',
    'Evidence-grounded reasoning sequence preview': 'Kanıta dayalı akıl yürütme akışı önizlemesi',
    'Izge product architecture layers': 'Izge ürün mimarisi katmanları',
    'Lower page navigation': 'Alt sayfa navigasyonu',
    'Footer navigation': 'Alt bilgi navigasyonu',
  },
  text: {
    'TRY DEMO': 'DEMOYU DENE',
    'Anti-category': 'Anti-Kategori',
    'Scenario': 'Senaryo',
    'System': 'Sistem',
    'Boundary': 'LOCAL-FIRST',
    'Modes': 'Modlar',
    'Trust': 'Güven',
    'Manifesto': 'Manifesto',
    'local-first decision intelligence': 'LOCAL-FIRST karar mekanizması',
    'local-first institutional memory': 'Local-first kurumsal hafıza',
    'Izge reveals the hidden structure of organizational memory.': 'Geçmişin örgüsünü çöz, kararları netleştir, yarını bugüne getir.',
    'Izge reconstructs the record inside a company-controlled trust boundary.': 'Izge, kurumsal hafızayı şirketin kontrol ettiği güvenli sınırlar içinde yeniden kurar.',
    'Not chat over files. Not internal search. Izge reconstructs decisions, assumptions, constraints, commitments, outcomes, contradictions, drift, and next actions from the artifacts your team already leaves behind — with private/local inference assisting, not deciding.': 'Belgeler üstüne sohbet değil. Kurumsal arama motoru hiç değil. Izge, ekibinizin geride bıraktığı doküman ve kayıtlardan kararları, varsayımları, kısıtları, taahhütleri, sonuçları, çelişkileri, varsayım sapmalarını ve önerilen sonraki adımları yeniden kurar — yerelde güvenli çıkarım yapmanızı sağlar.',
    'See the trust boundary': 'NEDEN LOCAL-FIRST',
    'Calm pattern': 'Sakin yapı',
    'Organizational memory has structure before it has answers.': 'Hafıza söz konusuysa cevaplardan önce yapı gelir.',
    'Fiber keys: decision · assumption · constraint · commitment · outcome': 'Temel parçalar: karar · varsayım · kısıt · taahhüt · sonuç',
    'Decision thread': 'Karar hattı',
    'A decision is never alone; it is held in place by the weave around it.': 'Hiçbir karar tek başına var olmaz; onu taşıyan bir hafıza örgüsü vardır.',
    'Thread keys: decision · lineage · evidence context': 'Hat parçaları: karar · karar geçmişi · kanıt bağlamı',
    'Supporting structure': 'Dayanak yapısı',
    'It is shaped by assumptions, constraints, commitments, and outcomes.': 'Varsayımlar, kısıtlar, taahhütler ve sonuçlar kararı birlikte şekillendirir.',
    'Support keys: assumption · constraint · commitment · outcome': 'Dayanaklar: varsayım · kısıt · taahhüt · sonuç',
    'Contradiction tension': 'Çelişki gerilimi',
    'When history and current direction collide, Izge makes the tension visible.': 'Dünle bugünün çatışmasını görünür kılar Izge.',
    'Tension keys: contradiction · drift · supersession · evidence link': 'Gerilim parçaları: çelişki · varsayım sapması · yerine geçme · kanıt bağlantısı',
    'Next-action path': 'Sonraki aksiyon yolu',
    'Izge turns organizational memory into decision intelligence.': 'Izge, kurumsal hafızayı karar mekanizmasına dönüştürür.',
    'Route keys: next action · dependency · review gate · decision path': 'Rota parçaları: sonraki adım · bağımlılık · kontrol noktası · karar yolu',
    'Memory under tension': 'Gerilim altındaki hafıza',
    'stable memory': 'sağlam hafıza',
    'contradiction': 'çelişki',
    'assumption drift': 'varsayım sapması',
    'next action': 'sonraki aksiyon',
    'Category refusal': 'Anti Kategori',
    'If it looks like chat over files, it already lost the plot.': 'Mesele belge üstünde konuşmak değil, kurumsal hafızayı yeniden kurmak.',
    'Not internal search.': 'Kurumsal arama değil.',
    'Not chat over files.': 'Dosyalar üstüne sohbet eden bir chatbot değil.',
    'Not a PM copilot.': 'Proje müdürü yardımcısı değil.',
    'Not a multi-tenant AI black box.': 'Ne işe yaradığı belli olmayan bir AI hiç değil.',
    'A system that remembers why decisions happened.': 'Kararların neden alındığını hatırlayan bir sistem.',
    'Use case scenario': 'Kullanım senaryosu',
    'Watch a decision come back to life.': 'Bir kararın su yüzüne çıkışına tanık olun.',
    'Upload the fragments. Izge reconstructs what was decided, why it happened, what later contradicted it, and what should happen next. A new artifact can trigger contradiction, drift, supersession, continuity, or next-action signals against existing memory.': 'Izge neye karar verildiğini, kararın neden alındığını, sonradan neyin bununla çeliştiğini ve şimdi ne yapılması gerektiğini yeniden kurar. Yeni bir doküman ya da kayıt, mevcut hafızaya karşı çelişki, varsayım sapması, yerine geçme, süreklilik veya sonraki aksiyon sinyali üretebilir.',
    'roadmap_notes.md': 'roadmap_notes.md',
    'Delay self-serve onboarding to Q3.': 'Self-servis onboarding’i Q3’e ertele.',
    'q2_planning.pdf': 'q2_planning.pdf',
    'Reopen late-Q2 launch scope.': 'Geç Q2 lansman kapsamını yeniden aç.',
    'launch_review.txt': 'launch_review.txt',
    'Manual onboarding capacity is strained.': 'Manuel onboarding kapasitesi zorlanıyor.',
    'pasted meeting excerpt': 'toplantı notu alıntısı',
    'Security approval still unresolved.': 'Güvenlik onayı hâlâ çözülmedi.',
    'Decision': 'Karar',
    'Assumption': 'Varsayım',
    'Constraint': 'Kısıt',
    'Commitment': 'Taahhüt',
    'Outcome': 'Sonuç',
    'Self-serve onboarding delayed to Q3': 'Self-servis onboarding Q3’e ertelendi',
    'Based on': 'Dayanak',
    'Activation instrumentation not ready': 'Aktivasyon ölçüm altyapısı hazır değil',
    'Constrained by': 'Kısıt',
    'Manual onboarding capacity': 'Manuel onboarding kapasitesi',
    'Later plan': 'Sonraki plan',
    'Reintroduce launch in late Q2': 'Lansmanı geç Q2’de yeniden gündeme al',
    'Dependency': 'Bağımlılık',
    'Security approval unresolved': 'Güvenlik onayı çözülmedi',
    'Evidence-grounded next move': 'Kanıta dayalı sonraki adım',
    'Schedule activation-readiness review before reopening launch scope.': 'Özelliği tekrar çıkarmadan önce hazır olup olmadığını kontrol etmeyi planla.',
    'Resolve security approval dependency.': 'Geçmişteki değerlendirmeyi göz önünde bulundur.',
    'Revalidate manual onboarding capacity assumption.': 'Manuel onboarding varsayımını yeniden doğrula.',
    '01 / Ingest the fragments': '01 / Parçaları içeri al',
    'A messy artifact pile enters the record.': 'Dağınık doküman yığını sistem kaydına girer.',
    'Roadmap notes, a planning PDF, a launch review, and a pasted meeting excerpt arrive as evidence-bearing sources.': 'Roadmap notları, planlama PDF’i, lansman değerlendirmesi ve toplantı notu alıntısı kanıt taşıyan kaynaklar olarak sisteme girer.',
    '02 / Extract the memory': '02 / Hafızayı çıkar',
    'The fragments become institutional memory objects.': 'Bu parçalar, kurumsal hafıza nesnelerine dönüşür.',
    'Izge extracts decisions, assumptions, constraints, commitments, and outcomes without turning the product into chat over files.': 'Izge, kararları, varsayımları, kısıtları, taahhütleri ve sonuçları gün yüzüne çıkarır.',
    '03 / Rebuild the lineage': '03 / Karar geçmişini yeniden kur',
    'The original reasoning becomes visible again.': 'Kararın dayandığı mantık yeniden görünür hale gelir.',
    'The Q3 delay connects to activation instrumentation and manual onboarding capacity, making the decision inspectable.': 'Q3 ertelemesi aktivasyon ölçüm altyapısına ve manuel onboarding kapasitesine bağlanır; kararın geçmişi incelenebilir hale gelir.',
    '04 / Surface the contradiction': '04 / Çelişkiyi görünür kıl',
    'The record starts arguing with the new plan.': 'Yeni plan eski kayıtlarla çelişmeye başlar.',
    'A later late-Q2 launch proposal collides with the prior Q3 decision. The conflict is evidence-linked, not inferred from vibes.': 'Daha sonra gelen geç Q2 lansman önerisi önceki Q3 kararıyla çatışır. Çelişki sezgiye değil, kanıt bağlantısına dayanır.',
    '05 / Recommend the next move': '05 / Sonraki adımı öner',
    'The action is serious because the evidence is visible.': 'Aksiyon önerisi ciddidir, çünkü dayandığı kanıt görünürdedir.',
    'Izge recommends readiness review, security approval resolution, and assumption revalidation before scope reopens.': 'Izge kapsam yeniden açılmadan önce hazırlık kontrolü, güvenlik onayının kapatılması ve varsayımın yeniden doğrulanmasını önerir.',
    'The actual failure mode': 'Asıl kırılma noktası',
    'The old debate returns wearing a new filename.': 'Eski tartışma, bu kez yeni bir dosya adıyla geri döner.',
    'Critical context is scattered across roadmap notes, product strategy docs, meeting writeups, pasted text, and PDFs. Teams repeat decisions, act on expired assumptions, and create commitments that quietly contradict the record.': 'Kritik bağlam roadmap notlarına, ürün stratejisi dokümanlarına, toplantı özetlerine, yapıştırılmış metinlere ve PDF’lere dağılır. Ekipler kararları tekrar eder, geçerliliğini yitirmiş varsayımlarla ilerler ve kayıtla sessizce çelişen taahhütler üretir.',
    'roadmap.md': 'roadmap.md',
    '“Focus onboarding until activation stabilizes.”': '“Aktivasyon istikrara kavuşana kadar onboarding’e odaklan.”',
    'strategy.pdf': 'strategy.pdf',
    '“Move sprint capacity into pricing experiments.”': '“Sprint kapasitesini fiyatlandırma deneylerine kaydır.”',
    'meeting-notes.txt': 'meeting-notes.txt',
    '“Assumption: education is the bottleneck.”': '“Varsayım: kullanıcılara sunulan tutorial darboğaz.”',
    'pasted text': 'yapıştırılmış metin',
    '“Decision owner unclear after reorg.”': 'Kararın nasıl alındığı belirsiz.”',
    'Memory boundary': 'Hafızanın sınırları',
    '01 / Ingest': '01 / İçeri al',
    'Artifacts enter as evidence, not vibes.': 'Dokümanlar sezgiyle değil, kanıt olarak sisteme girer.',
    'Markdown, plain text, PDFs, and pasted text become source-bounded objects with provenance attached.': 'Markdown, düz metin, PDF ve yapıştırılmış metinler; kaynağı belli, köken bilgisi bağlı hafıza nesnelerine dönüşür.',
    '02 / Reconstruct': '02 / Yeniden kur',
    'Decisions become structured memory.': 'Kararlar yapılandırılmış hafızaya dönüşür.',
    'Izge extracts decisions, assumptions, constraints, outcomes, commitments, owners, and timestamps into a traceable graph.': 'Izge kararları, varsayımları, kısıtları, sonuçları, taahhütleri, sahipleri ve zaman damgalarını izlenebilir bir graf yapısına çıkarır.',
    '03 / Govern': '03 / Yönet',
    'Evidence has a trust status before it becomes authority.': 'Sisteme girecek her belge kapı ağzında yöneticiler tarafından incelenir.',
    'Admins review artifacts, manage visibility, and reject sources that should stay stored but out of trusted reasoning.': 'Adminler dokümanları inceler, gerekirse görünürlüğünü kısıtlar ve saklanması gereken, çıkarıma dahil edilmemesi gereken kaynakları dışarıda bırakır.',
    '04 / Reason': '04 / Akıl yürüt',
    'The record starts arguing with itself.': 'Mevcut kayıtlar kendisiyle çelişmeye başlar.',
    'Contradictions, drift, lineage, uncertainty, and permission limits become visible before recommendations appear.': 'Öneriler görünmeden önce çelişkiler, varsayım sapmaları, karar geçmişi, belirsizlik ve izin sınırları görünür hale gelir.',
    '05 / Assist': '05 / Yardımcı ol',
    'The local LLM helps explain the packet. It does not become the record.': 'Yerel LLM, bağlamı açıklamaya yardımcı olur; kaydın kendisi haline gelmez.',
    'Private inference can assist extraction, intent routing, answer wording, and signal explanation while deterministic graph logic remains the authority.': 'Özel çıkarım (private inference), her zaman işleri kolaylaştırmaya yarar, daha da zorlaştırmaya değil.',
    'Local-first trust boundary': 'LOCAL-FIRST GÜVEN SINIRI',
    'The LLM is a helper. The institutional record is the authority.': 'LLM bir yardımcı sadece. Otorite halen mevcut işleyişte.',
    'Local-first does not mean localhost. It means artifacts, memory, permissions, and inference stay inside an organization-controlled boundary. The browser UI can be served from a customer/internal URL.': 'Local-first, her çalışanın localhost çalıştırması demek değildir. Dokümanların, hafızanın, izinlerin ve çıkarım sürecinin kurum kontrollü bir sınır içinde kalması demektir. Tarayıcı arayüzü müşteri ortamından ya da kurum içi bir URL’den sunulabilir.',
    'Authority layer': 'Otorite katmanı',
    'Deterministic memory engine': 'Deterministik hafıza motoru',
    'Permissions, artifact review, graph construction, signal classification, persistence, and audit trails stay deterministic and inspectable.': 'İzinler, doküman incelemesi, grafın kurulması, sinyal sınıflandırması, kalıcılık ve denetim izleri deterministik ve incelenebilir kalır.',
    'Private inference': 'Özel çıkarım',
    'Local/private LLM helper': 'Yerel/özel LLM desteği',
    'LLM assistance is bounded to extraction help, query intent routing, final-answer wording, and explanation of already-detected signals.': 'LLM desteği; hafıza çıkarımı, sorgu niyeti yönlendirme, nihai cevap metni ve zaten tespit edilmiş sinyallerin açıklanmasıyla sınırlıdır.',
    'Fail closed': 'Güvenli fallback',
    'Schema validation and fallback': 'Şema doğrulama ve fallback',
    'If the model is slow, malformed, or overreaches, Izge falls back to deterministic output and preserves the fallback boundary.': 'Model yavaşsa, hatalı yapı döndürürse ya da sınırı aşarsa Izge deterministik çıktıya geri döner ve güvenli fallback sınırını korur.',
    'Deployment stance': 'Kurulum',
    'Demo now. Customer-controlled target.': 'Bugün demo. Hedef: müşteri kontrollü kurulum.',
    'Admin': 'Admin',
    'Prepare and govern the memory.': 'Hafızayı hazırla ve yönet.',
    'Upload and inspect artifacts.': 'Dokümanları yükle ve incele.',
    'Review evidence before it becomes trusted.': 'Kanıt güvenilir olmadan önce incele.',
    'Verify local/private LLM readiness.': 'Yerel/özel LLM hazır durumunu doğrula.',
    'Inspect contradiction, drift, and next-action signals.': 'Çelişki, varsayım sapması ve sonraki aksiyon sinyallerini incele.',
    'Member': 'Üye',
    'Consume and extend decision intelligence.': 'Karar mekanizmasından yararlan ve girdiyle zenginleştir.',
    'Contribute logs, reports, notes, and updates.': 'Log, rapor, not ve güncelleme ekle.',
    'Ask real questions in natural language.': 'Doğal dille gerçek sorular sor.',
    'Inspect evidence, memory objects, and uncertainty.': 'Kanıtı, hafıza nesnelerini ve belirsizliği incele.',
    'Use grounded guidance without turning memory into chat.': 'Hafızayı sohbete çevirmeden kanıta dayalı yönlendirme kullan.',
    'Four reasoning modes': 'Dört akıl yürütme modu',
    'Decision intelligence is not a chat box. It is a sequence of bounded checks.': 'Karar zekâsı bir sohbet arayüzü değil, disiplinli bir kontrol akışıdır.',
    'Decision lineage': 'Karar geçmişi',
    'Rebuild the path from proposal to decision to consequence.': 'Öneriden karara, karardan sonuca uzanan yolu yeniden kurar.',
    'Contradiction analysis': 'Çelişki analizi',
    'Expose when a later plan conflicts with an earlier commitment.': 'Daha sonraki bir planın önceki bir taahhütle nerede çatıştığını ortaya çıkarır.',
    'Assumption drift': 'Varsayım sapması',
    'Detect assumptions that quietly expired while the team kept moving.': 'Ekip ilerlemeye devam ederken sessizce geçerliliğini yitiren varsayımları tespit eder.',
    'Next-action guidance': 'Önerilen sonraki adım',
    'Recommend the next move only after evidence, conflict, drift, and open commitments are inspectable.': 'Sonraki adımı ancak kanıt, çelişki, varsayım sapması ve açık taahhütler incelenebilir hale geldikten sonra önerir.',
    'source span': 'kaynak kesiti',
    'decision edge': 'karar bağlantısı',
    'conflict edge': 'çelişki bağlantısı',
    'recommended check': 'önerilen kontrol',
    'Current plan conflicts with the recorded onboarding commitment.': 'Mevcut plan, kaydedilmiş onboarding taahhüdüyle çelişiyor.',
    'Next action: inspect rationale before reallocating sprint capacity.': 'Sonraki aksiyon: sprint kapasitesini yeniden dağıtmadan önce gerekçeyi incele.',
    'Product trajectory': 'Ürün yönü',
    'A layered system for organizational judgment.': 'Kurumsal muhakeme için katmanlı bir sistem.',
    'Layer 01': 'Katman 01',
    'Institution Memory Engine': 'Kurumsal Hafıza Motoru',
    'Structured extraction, graph relationships, provenance, permissions, and auditability.': 'Yapılandırılmış çıkarım, graf ilişkileri, kaynak geçmişi, izinler ve denetlenebilirlik.',
    'Layer 02': 'Katman 02',
    'Decision Guidance Layer': 'Karar Yönlendirme Katmanı',
    'Evidence-aware reasoning over lineage, contradiction, drift, uncertainty, and next actions.': 'Karar geçmişi, çelişki, varsayım sapması, belirsizlik ve sonraki aksiyonlar üzerinde kanıt-duyarlı akıl yürütme.',
    'Layer 03': 'Katman 03',
    'Scenario / Simulation Support - coming soon': 'Senaryo / Simülasyon Katmanı - çok yakında',
    'What happens if we choose option A vs B?': 'Acaba\'lara son.',
    'Why it can win': 'Neden güçlü',
    'Trust is not a feature added later. It is the architecture.': 'Güven sonradan eklenen bir özellik değil, mimarinin kendisidir.',
    'Organization-controlled by design': 'Tasarım prensibi olarak kontrol sizde.',
    'Private memory should not begin inside a multi-tenant AI black box.': 'Özel bilgileriniz uzak bir ülkedeki bir veri merkezinde güvende mi?',
    'Evidence-aware reasoning': 'Kanıt-duyarlı akıl yürütme',
    'Every answer should show what evidence supported it and what evidence was missing.': 'Her cevap hangi kanıta dayandığını ve hangi kanıtın eksik kaldığını gösterir.',
    'Graph-backed intelligence': 'Ağ yapısal zekâ',
    'Contradictions need relationships, not keyword matches.': 'Çelişki saptamak için kelime eşleşmesi değil, ilişkiler örgüsü gerekir.',
    'Deterministic authority': 'Deterministik otorite',
    'The system must remember how it reasoned, when the LLM helped, and when fallback protected the record.': 'Sistem nasıl akıl yürüttüğünü, LLM’nin ne zaman destek verdiğini ve işleyişin ne zaman fallback tarafından korunduğunu hatırlar.',
    'History before speculation.': 'Önce geçmiş, sonra varsayım.',
    'Evidence reconstruction': 'Kanıtların yeniden kurulması',
    'Evidence before confidence.': 'Önce kanıt, sonra güven.',
    'Structure before summary.': 'Önce yapı, sonra özet.',
    'Private inference before black boxes.': 'Bulutta değil yerelde.',
    'Local-first trust from day one.': 'İlk günden LOCAL-FIRST güven.',
    'Build memory that survives the next meeting.': 'Günü kurtarmaktan fazlası — sürekli hafıza.',
    'For product and roadmap teams entering the phase where forgotten rationale becomes strategic drag.': 'Unutulan karar gerekçelerinin stratejik yük haline geldiği aşamadaki ürün ve roadmap ekipleri için.',
    'Return to the opening claim': 'Başa dön',
    'Memory boundary': 'Hafızanın sınırları',
    'Reasoning modes': 'Akıl yürütme modları',
    'Trust boundary': 'Güven sınırı',
    'Institutional memory, kept inspectable.': 'Kurumsal hafıza incelenebilir kalır.',
    'Local-first decision intelligence for teams that need lineage, contradiction, drift, and next-action clarity without turning their record into a black box.': 'Kayıtlarını kara kutuya çevirmeden karar geçmişi, çelişki, varsayım sapması ve sonraki aksiyon netliği isteyen ekipler için local-first karar mekanizması.',
    'Product': 'Ürün',
    'Use case scenario': 'Kullanım senaryosu',
    'Access': 'Erişim',
    'Contact us': 'Bize ulaşın',
    'Request MVP brief': 'MVP özetini iste',
    'Share demo scenario': 'Demo senaryosu paylaş',
    'Local-first posture': 'LOCAL-FIRST duruş',
    'Security contact': 'Güvenlik iletişimi',
    'Evidence-linked outputs': 'Kanıt bağlantılı çıktılar',
    'Operating posture': 'İşleyiş',
    'Organization-controlled memory': 'Kurum kontrollü hafıza',
    'Private/local inference helper': 'Özel/yerel çıkarım desteği',
    'Decision lineage first': 'Önce karar geçmişi',
    'Fail-closed fallback': 'Güvenli fallback',
    'Memory before magic.': 'Hafıza önce gelir.',
    'Back to top': 'Başa dön',
  },
};

function normalizeI18nText(value) {
  return value.replace(/\s+/g, ' ').trim();
}

function getStoredLanguage() {
  try {
    const storedLanguage = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
    if (storedLanguage && SUPPORTED_LANGUAGES.has(storedLanguage)) return storedLanguage;
  } catch {
    // Ignore storage failures; language can still be switched for the current page load.
  }

  const browserLanguage = window.navigator.language?.toLowerCase() || '';
  return browserLanguage.startsWith('tr') ? 'tr' : 'en';
}

function storeLanguage(language) {
  try {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
  } catch {
    // Ignore storage failures.
  }
}

function translateLeafText(language) {
  const candidates = document.querySelectorAll('a, button, dd, dt, h1, h2, h3, li, p, small, span, strong');
  candidates.forEach(element => {
    if (element.closest('script, style, svg')) return;
    if (element.children.length > 0) return;

    const originalText = element.dataset.i18nOriginal || normalizeI18nText(element.textContent || '');
    if (!originalText) return;
    element.dataset.i18nOriginal = originalText;
    element.textContent = language === 'tr' ? PAGE_I18N.text[originalText] || originalText : originalText;
  });
}

function translateHtmlBlocks(language) {
  document.querySelectorAll('[data-i18n-html]').forEach(element => {
    const key = element.dataset.i18nHtml;
    if (!key) return;
    const originalHtml = element.dataset.i18nOriginalHtml || element.innerHTML;
    element.dataset.i18nOriginalHtml = originalHtml;
    element.innerHTML = language === 'tr' ? PAGE_I18N.html[key]?.tr || originalHtml : PAGE_I18N.html[key]?.en || originalHtml;
  });
}

function translateAriaLabels(language) {
  document.querySelectorAll('[aria-label]').forEach(element => {
    const originalLabel = element.dataset.i18nOriginalAria || element.getAttribute('aria-label') || '';
    if (!originalLabel) return;
    element.dataset.i18nOriginalAria = originalLabel;
    element.setAttribute('aria-label', language === 'tr' ? PAGE_I18N.aria[originalLabel] || originalLabel : originalLabel);
  });
}

function updateLanguageButtons(language) {
  document.querySelectorAll('[data-lang-toggle]').forEach(button => {
    const isCurrentLanguage = button.dataset.langToggle === language;
    button.setAttribute('aria-pressed', String(isCurrentLanguage));
    button.classList.toggle('is-active', isCurrentLanguage);
  });
}

function applyLanguage(language) {
  const nextLanguage = SUPPORTED_LANGUAGES.has(language) ? language : 'en';
  document.documentElement.lang = nextLanguage;
  document.title = PAGE_I18N.title[nextLanguage] || PAGE_I18N.title.en;
  document.querySelector('meta[name="description"]')?.setAttribute('content', PAGE_I18N.description[nextLanguage] || PAGE_I18N.description.en);
  translateLeafText(nextLanguage);
  translateHtmlBlocks(nextLanguage);
  translateAriaLabels(nextLanguage);
  updateLanguageButtons(nextLanguage);
  storeLanguage(nextLanguage);
}

document.querySelectorAll('[data-lang-toggle]').forEach(button => {
  button.addEventListener('click', () => {
    const language = button.dataset.langToggle || 'en';
    applyLanguage(language);
  });
});

applyLanguage(getStoredLanguage());
